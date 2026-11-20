/**
 * The C1 repository boundary (schema and repository map §2.5 and §5).
 *
 * Two rules are enforced here rather than left to callers, because C1's cases
 * test them directly:
 *
 * 1. Every call takes `tenantId` first and refuses a missing or blank one with
 *    `MalformedQuery`. No repository reads `QUICKSILVER_TENANT_ID`, a request
 *    body, a query parameter, or a default tenant. A03 and A04 exist to prove it.
 * 2. A read is tenant-qualified. A foreign id is `NotFound`, never a body, a
 *    tenant name, or an existence signal.
 *
 * Stage 1 implements reads for every store and the organization create path
 * A02 needs. Mutations for other aggregates arrive with their gates; they are
 * absent rather than stubbed so no caller can mistake one for implemented.
 */
import { C1_STORES } from './catalog.ts'
import {
  AppendOnlyViolationError,
  AuditWriteFailedError,
  CrossTenantRelationError,
  MalformedQueryError,
  NotFoundError,
  RevisionConflictError,
  UnresolvedRelationError,
} from './errors.ts'
import { type CmsStore, digestOf, type StoredRow } from './store.ts'
import { linkRelation, relationById } from './relations.ts'
import { runIdempotent } from './idempotency.ts'
import { requireTenant, type TenantId } from './tenancy.ts'

export { requireTenant, type TenantId } from './tenancy.ts'

export interface PageRequest {
  cursor?: string
  /** 1..100; a caller cannot raise the server maximum. */
  limit: number
}

export interface WriteOptions {
  actorId: string
  expectedRevision?: number
  idempotencyKey?: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
  truncated: boolean
}

export interface ContentRecord {
  id: string
  tenant_id: string
  revision: number
  published_revision?: number
  [key: string]: unknown
}

const MAX_LIMIT = 100

function encodeCursor(tenantId: TenantId, id: string): string {
  return Buffer.from(JSON.stringify({ tenant: tenantId, id })).toString('base64url')
}

/** A cursor is opaque and tenant-bound; it never widens or crosses tenants. */
function decodeCursor(cursor: unknown, tenantId: TenantId): string | null {
  if (cursor === undefined) return null
  if (typeof cursor !== 'string' || cursor.length === 0) throw new MalformedQueryError('cursor must be a non-empty string')
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { tenant?: unknown; id?: unknown }
    if (parsed.tenant !== tenantId) throw new MalformedQueryError('cursor does not belong to this tenant')
    if (typeof parsed.id !== 'string' || parsed.id.length === 0) throw new MalformedQueryError('cursor is malformed')
    return parsed.id
  } catch (error) {
    if (error instanceof MalformedQueryError) throw error
    throw new MalformedQueryError('cursor is malformed')
  }
}

function requireLimit(page: PageRequest): number {
  const limit = page?.limit
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new MalformedQueryError(`limit must be an integer between 1 and ${MAX_LIMIT}`)
  }
  return limit
}

function findRow(store: CmsStore, table: string, tenantId: TenantId, id: string): StoredRow | undefined {
  return store.rows(table).find((row) => row.tenant_id === tenantId && row.id === id)
}

/** Tenant-qualified reads shared by every store's repository. */
export class BaseRepository<T extends ContentRecord> {
  protected readonly store: CmsStore
  readonly table: string

  constructor(store: CmsStore, table: string) {
    this.store = store
    this.table = table
  }

  async get(tenantId: TenantId, id: string, options: { revision?: number; includeDraft?: boolean } = {}): Promise<T> {
    const tenant = requireTenant(tenantId)
    if (typeof id !== 'string' || id.trim().length === 0) throw new MalformedQueryError('id is required')
    const row = findRow(this.store, this.table, tenant, id)
    if (!row) throw new NotFoundError()
    if (options.revision !== undefined) return this.getRevision(tenant, id, options.revision) as Promise<T>
    // Editorial readers default to the published revision (§2.3). A record that
    // was never published has no published revision to resolve.
    if (!options.includeDraft && row.published_revision !== undefined && row.published_revision !== null) {
      const snapshot = this.store
        .rows('qs_content_revisions')
        .find(
          (candidate) =>
            candidate.tenant_id === tenant &&
            candidate.record_id === id &&
            Number(candidate.revision) === Number(row.published_revision) &&
            candidate.state !== 'draft',
        )
      if (snapshot) return structuredClone(snapshot.snapshot) as T
    }
    return structuredClone(row) as T
  }

  /** Immutable revision snapshots, newest first. */
  async revisions(tenantId: TenantId, id: string, page: PageRequest): Promise<Page<{ revision: number; digest: string; state: string; actor_id: string; created_at: string }>> {
    const tenant = requireTenant(tenantId)
    const limit = requireLimit(page)
    if (!findRow(this.store, this.table, tenant, id)) throw new NotFoundError()
    const rows = this.store
      .rows('qs_content_revisions')
      .filter((row) => row.tenant_id === tenant && row.record_id === id)
      .sort((left, right) => Number(right.revision) - Number(left.revision))
      .slice(0, limit)
      .map((row) => ({
        revision: Number(row.revision),
        digest: String(row.digest),
        state: String(row.state),
        actor_id: String(row.actor_id),
        created_at: String(row.created_at),
      }))
    return { items: rows, nextCursor: null, truncated: false }
  }

  async getRevision(tenantId: TenantId, id: string, revision: number): Promise<T> {
    const tenant = requireTenant(tenantId)
    if (!Number.isInteger(revision) || revision < 1) throw new MalformedQueryError('revision must be a positive integer')
    const row = this.store
      .rows('qs_content_revisions')
      .find(
        (candidate) =>
          candidate.tenant_id === tenant && candidate.record_id === id && Number(candidate.revision) === revision,
      )
    if (!row) throw new NotFoundError('revision not found')
    return structuredClone(row.snapshot) as T
  }

  /** Expected-revision compare-and-swap; a mismatch never overwrites (§2.3). */
  async update(tenantId: TenantId, id: string, patch: Record<string, unknown>, options: WriteOptions & { expectedRevision: number }): Promise<T> {
    const tenant = requireTenant(tenantId)
    if (!patch || typeof patch !== 'object') throw new MalformedQueryError('patch is required')
    // Identity and ownership are never patchable: a tenant is the call's, not a
    // payload field (F06).
    if ('tenant_id' in patch || 'id' in patch) {
      throw new MalformedQueryError('tenant_id and id are not patchable')
    }
    const row = this.writable(tenant, id, options, 'content.update')
    const revision = Number(row.revision) + 1
    const at = this.store.clock.now()
    const updated = this.store.replace(this.table, tenant, id, {
      ...patch,
      tenant_id: tenant,
      revision,
      updated_at: at,
      updated_by: options.actorId,
    })
    this.snapshot(tenant, id, revision, 'draft', updated, options.actorId, at)
    return updated as T
  }

  /** Publishes one existing revision; it does not allocate a new one. */
  async publish(tenantId: TenantId, id: string, revision: number, options: WriteOptions & { expectedRevision: number }): Promise<T> {
    const tenant = requireTenant(tenantId)
    const row = this.writable(tenant, id, options, 'content.publish')
    if (!Number.isInteger(revision) || revision < 1) throw new MalformedQueryError('revision must be a positive integer')
    const exists = this.store
      .rows('qs_content_revisions')
      .some((candidate) => candidate.tenant_id === tenant && candidate.record_id === id && Number(candidate.revision) === revision)
    if (!exists) throw new NotFoundError('revision not found')
    const at = this.store.clock.now()
    const updated = this.store.replace(this.table, tenant, id, {
      lifecycle: 'published',
      published_revision: revision,
      updated_at: at,
      updated_by: options.actorId,
    })
    // Publishing marks the existing snapshot; it does not rewrite its body or
    // allocate a revision, so the published digest cannot change under review.
    const snapshot = this.store
      .rows('qs_content_revisions')
      .find((candidate) => candidate.tenant_id === tenant && candidate.record_id === id && Number(candidate.revision) === revision)
    // Every revision row is addressable; publishing marks it rather than
    // appending a second row with the same revision number.
    if (!snapshot || typeof snapshot.id !== 'string') {
      throw new MalformedQueryError('revision snapshot is missing its id')
    }
    this.store.replace('qs_content_revisions', tenant, snapshot.id, { state: 'published' })
    return updated as T
  }

  async archive(tenantId: TenantId, id: string, options: WriteOptions & { expectedRevision: number }): Promise<T> {
    const tenant = requireTenant(tenantId)
    const row = this.writable(tenant, id, options, 'content.archive')
    const revision = Number(row.revision) + 1
    const at = this.store.clock.now()
    const updated = this.store.replace(this.table, tenant, id, {
      lifecycle: 'archived',
      revision,
      updated_at: at,
      updated_by: options.actorId,
    })
    this.snapshot(tenant, id, revision, 'archived', updated, options.actorId, at)
    return updated as T
  }

  async softDelete(tenantId: TenantId, id: string, options: WriteOptions & { expectedRevision: number }): Promise<T> {
    const tenant = requireTenant(tenantId)
    const row = this.writable(tenant, id, options, 'content.delete')
    const revision = Number(row.revision) + 1
    const at = this.store.clock.now()
    const updated = this.store.replace(this.table, tenant, id, {
      revision,
      deleted_at: at,
      deleted_by: options.actorId,
      delete_reason: 'soft-delete',
      purge_after: new Date(Date.parse(at) + 30 * 86_400_000).toISOString(),
      updated_at: at,
      updated_by: options.actorId,
    })
    this.snapshot(tenant, id, revision, 'tombstoned', updated, options.actorId, at)
    return updated as T
  }

  /** A repeated update with the same key replays its first result (§6 D06). */
  async updateIdempotent(
    tenantId: TenantId,
    id: string,
    patch: Record<string, unknown>,
    options: WriteOptions & { expectedRevision: number; idempotencyKey: string },
  ): Promise<T> {
    const { idempotencyKey, ...write } = options
    const outcome = await runIdempotent(
      this.store,
      tenantId,
      'update',
      idempotencyKey,
      { id, patch, expectedRevision: options.expectedRevision, actorId: options.actorId },
      () => this.update(tenantId, id, patch, write),
    )
    return structuredClone(outcome.result) as T
  }

  /** A repeated publish with the same key replays its first result (§6 D06). */
  async publishIdempotent(
    tenantId: TenantId,
    id: string,
    revision: number,
    options: WriteOptions & { expectedRevision: number; idempotencyKey: string },
  ): Promise<T> {
    const { idempotencyKey, ...write } = options
    const outcome = await runIdempotent(
      this.store,
      tenantId,
      'publish',
      idempotencyKey,
      { id, revision, expectedRevision: options.expectedRevision, actorId: options.actorId },
      () => this.publish(tenantId, id, revision, write),
    )
    return structuredClone(outcome.result) as T
  }

  async restore(tenantId: TenantId, id: string, options: WriteOptions & { expectedRevision: number }): Promise<T> {
    const tenant = requireTenant(tenantId)
    const row = this.writable(tenant, id, options, 'content.restore')
    const revision = Number(row.revision) + 1
    const at = this.store.clock.now()
    const updated = this.store.replace(this.table, tenant, id, {
      revision,
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
      purge_after: null,
      updated_at: at,
      updated_by: options.actorId,
    })
    this.snapshot(tenant, id, revision, 'restored', updated, options.actorId, at)
    return updated as T
  }

  /** Shared checks for a mutating write: actor, expected revision, audit fault. */
  protected writable(
    tenant: TenantId,
    id: string,
    options: WriteOptions & { expectedRevision?: number },
    auditOperation: string,
  ): StoredRow {
    if (!options || typeof options.actorId !== 'string' || !options.actorId.trim()) {
      throw new MalformedQueryError('actorId is required')
    }
    const row = findRow(this.store, this.table, tenant, id)
    if (!row) throw new NotFoundError()
    if (!Number.isInteger(options.expectedRevision)) throw new MalformedQueryError('expectedRevision is required')
    if (Number(row.revision) !== options.expectedRevision) throw new RevisionConflictError()
    if (this.store.consumeAuditFault(auditOperation, 'qs_content_revisions')) throw new AuditWriteFailedError()
    return row
  }

  private snapshot(tenant: TenantId, id: string, revision: number, state: string, snapshot: StoredRow, actorId: string, at: string): void {
    this.store.insert('qs_content_revisions', {
      tenant_id: tenant,
      id: this.store.ids.next('rev'),
      record_type: this.table,
      record_id: id,
      revision,
      state,
      snapshot,
      digest: digestOf(snapshot),
      actor_id: actorId,
      created_at: at,
    })
  }

  /** Business-key lookup. Tenant-qualified, so a collision cannot merge rows. */
  async getByKey(tenantId: TenantId, field: string, value: string): Promise<T> {
    const tenant = requireTenant(tenantId)
    if (typeof field !== 'string' || !field.trim()) throw new MalformedQueryError('field is required')
    if (typeof value !== 'string' || !value.trim()) throw new MalformedQueryError('value is required')
    const row = this.store
      .rows(this.table)
      .find((candidate) => candidate.tenant_id === tenant && candidate[field] === value)
    if (!row) throw new NotFoundError()
    return structuredClone(row) as T
  }

  async list(tenantId: TenantId, page: PageRequest): Promise<Page<T>> {
    const tenant = requireTenant(tenantId)
    const limit = requireLimit(page)
    const after = decodeCursor(page?.cursor, tenant)
    const rows = this.store
      .rows(this.table)
      .filter((row) => row.tenant_id === tenant && typeof row.deleted_at !== 'string')
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    const start = after === null ? 0 : rows.findIndex((row) => String(row.id) > after)
    const from = start === -1 ? rows.length : start
    const items = rows.slice(from, from + limit).map((row) => structuredClone(row) as T)
    const last = items.at(-1)
    return {
      items,
      nextCursor: items.length === limit && last ? encodeCursor(tenant, String(last.id)) : null,
      truncated: from + limit < rows.length,
    }
  }
}

export interface OrganizationRecord extends ContentRecord {
  name: string
  slug: string
  root: true
  lifecycle: 'draft' | 'published'
}

export interface OrganizationInput {
  name: string
  slug?: string
  mission?: string
  [key: string]: unknown
}

/**
 * The one aggregate Stage 1 implements end to end, because A02 needs a real
 * create and read. The write inserts the current row and its revision snapshot
 * together, and a failed revision append aborts before either lands.
 */
export class OrganizationRepository extends BaseRepository<OrganizationRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_organizations')
  }

  async getRoot(tenantId: TenantId): Promise<OrganizationRecord> {
    const tenant = requireTenant(tenantId)
    const root = this.store.rows(this.table).find((row) => row.tenant_id === tenant && row.root === true)
    if (!root) throw new NotFoundError('tenant has no root organization')
    return structuredClone(root) as OrganizationRecord
  }

  async create(tenantId: TenantId, input: OrganizationInput, options: WriteOptions): Promise<OrganizationRecord> {
    const tenant = requireTenant(tenantId)
    if (!options || typeof options.actorId !== 'string' || !options.actorId.trim()) {
      throw new MalformedQueryError('actorId is required')
    }
    if (!input || typeof input.name !== 'string' || !input.name.trim()) throw new MalformedQueryError('name is required')
    if (this.store.rows(this.table).some((row) => row.tenant_id === tenant && row.root === true)) {
      throw new MalformedQueryError('a tenant has exactly one root organization')
    }

    const at = this.store.clock.now()
    const slug = input.slug?.trim() || input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const record: OrganizationRecord = {
      ...input,
      slug,
      id: this.store.ids.next('org'),
      tenant_id: tenant,
      root: true,
      lifecycle: 'draft',
      revision: 1,
      created_at: at,
      created_by: options.actorId,
      updated_at: at,
      updated_by: options.actorId,
    }

    const revision = {
      tenant_id: tenant,
      record_type: 'organization',
      record_id: record.id,
      revision: 1,
      state: 'draft',
      snapshot: record,
      digest: digestOf(record),
      actor_id: options.actorId,
      created_at: at,
    }

    // The obligation first: a failed revision append leaves no record behind.
    if (this.store.consumeAuditFault('content.create', 'qs_content_revisions')) {
      throw new AuditWriteFailedError()
    }
    this.store.insert(this.table, record)
    this.store.insert('qs_content_revisions', revision)
    return structuredClone(record)
  }

  /** A repeated create with the same key returns the first record (§6 D01). */
  async createIdempotent(
    tenantId: TenantId,
    input: OrganizationInput,
    options: WriteOptions & { idempotencyKey: string },
  ): Promise<OrganizationRecord> {
    const { idempotencyKey, ...write } = options
    const outcome = await runIdempotent(
      this.store,
      tenantId,
      'create',
      idempotencyKey,
      { table: this.table, input, actorId: options.actorId },
      () => this.create(tenantId, input, write),
    )
    return structuredClone(outcome.result)
  }
}

export interface ObjectiveRecord extends ContentRecord {
  name: string
  owner_id: string | null
}

/**
 * Stage 2's first relation: an objective's owner must resolve inside the same
 * tenant. A target that exists elsewhere is `CrossTenantRelation` and never
 * rewritten to a local row; a target that exists nowhere is `UnresolvedRelation`.
 */
export class ObjectiveRepository extends BaseRepository<ObjectiveRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_objectives')
  }

  async setOwner(tenantId: TenantId, objectiveId: string, entityId: string, options: WriteOptions): Promise<ObjectiveRecord> {
    const tenant = requireTenant(tenantId)
    if (!options || typeof options.actorId !== 'string' || !options.actorId.trim()) {
      throw new MalformedQueryError('actorId is required')
    }
    const objective = this.store.findById(this.table, tenant, objectiveId)
    if (!objective) throw new NotFoundError()

    const target = this.store.findById('qs_entities', tenant, entityId)
    if (!target) {
      if (this.store.existsInAnotherTenant('qs_entities', tenant, entityId)) {
        throw new CrossTenantRelationError()
      }
      throw new UnresolvedRelationError()
    }

    // The obligation before the write: a failed revision append leaves the
    // current row untouched, so nothing has to be rolled back.
    if (this.store.consumeAuditFault('content.update', 'qs_content_revisions')) {
      throw new AuditWriteFailedError()
    }

    const at = this.store.clock.now()
    const revision = Number(objective.revision ?? 0) + 1
    const updated = this.store.replace(this.table, tenant, objectiveId, {
      owner_id: entityId,
      revision,
      updated_at: at,
      updated_by: options.actorId,
    })

    this.store.insert('qs_content_revisions', {
      tenant_id: tenant,
      record_type: 'objective',
      record_id: objectiveId,
      revision,
      state: 'draft',
      snapshot: updated,
      digest: digestOf(updated),
      actor_id: options.actorId,
      created_at: at,
    })
    return updated as ObjectiveRecord
  }
}

function link(store: CmsStore, tenantId: TenantId, relationId: string, sourceId: string, targetId: string, options: WriteOptions): void {
  linkRelation(store, tenantId, relationById(relationId), sourceId, targetId, options)
}

/** B06: a department member is a same-tenant entity. */
export class DepartmentRepository extends BaseRepository<ContentRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_departments')
  }

  async addMember(tenantId: TenantId, departmentId: string, entityId: string, options: WriteOptions): Promise<void> {
    link(this.store, tenantId, 'department.members', departmentId, entityId, options)
  }
}

/** B06: authorizing an entity for a capability writes the same-tenant join row. */
export class CapabilityRepository extends BaseRepository<ContentRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_capabilities')
  }

  async authorizeEntity(tenantId: TenantId, capabilityId: string, entityId: string, options: WriteOptions): Promise<void> {
    link(this.store, tenantId, 'capability.authorizedEntities', capabilityId, entityId, options)
  }
}

function appendDecisionEvent(
  store: CmsStore,
  tenantId: TenantId,
  decisionId: string,
  eventType: string,
  fromStatus: string | null,
  toStatus: string,
  actorId: string,
): void {
  const events = store
    .rows('qs_decision_events')
    .filter((row) => row.tenant_id === tenantId && row.decision_id === decisionId)
    .sort((left, right) => Number(left.seq) - Number(right.seq))
  const seq = events.reduce((max, row) => Math.max(max, Number(row.seq)), 0) + 1
  const previous = events.at(-1) ?? null
  const at = store.clock.now()
  const digest = digestOf({ decisionId, seq, eventType, fromStatus, toStatus, actorId, at })
  store.insert('qs_decision_events', {
    tenant_id: tenantId,
    id: store.ids.next('evt'),
    decision_id: decisionId,
    seq,
    event_id: store.ids.next('ev'),
    event_type: eventType,
    from_status: fromStatus,
    to_status: toStatus,
    actor_id: actorId,
    at,
    payload_digest: digest,
    prev_hash: previous?.hash ?? null,
    hash: digest,
  })
}

export type DecisionContextTarget = { entityId?: string; capabilityId?: string; policyId?: string }

/** B07: exactly one typed context target, all same-tenant, one decision event. */
export class DecisionRepository extends BaseRepository<ContentRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_decisions')
  }

  async setContext(tenantId: TenantId, decisionId: string, target: DecisionContextTarget, options: WriteOptions): Promise<ContentRecord> {
    const tenant = requireTenant(tenantId)
    if (!options || typeof options.actorId !== 'string' || !options.actorId.trim()) {
      throw new MalformedQueryError('actorId is required')
    }
    const decision = this.store.findById(this.table, tenant, decisionId)
    if (!decision) throw new NotFoundError()

    const provided = (['entityId', 'capabilityId', 'policyId'] as const).filter((key) => target?.[key] !== undefined)
    if (provided.length !== 1) throw new MalformedQueryError('exactly one context target type is required')
    const key = provided[0]!
    const table = key === 'entityId' ? 'qs_entities' : key === 'capabilityId' ? 'qs_capabilities' : 'qs_policies'
    const targetId = target[key]!

    if (!this.store.findById(table, tenant, targetId)) {
      if (this.store.existsInAnotherTenant(table, tenant, targetId)) throw new CrossTenantRelationError()
      throw new UnresolvedRelationError()
    }

    // The event is the obligation: a failed append leaves the projection and
    // the hash chain exactly as they were (E04).
    if (this.store.consumeAuditFault('decision.event', 'qs_decision_events')) throw new AuditWriteFailedError()

    const at = this.store.clock.now()
    const updated = this.store.replace(this.table, tenant, decisionId, {
      context_entity_id: key === 'entityId' ? targetId : null,
      context_capability_id: key === 'capabilityId' ? targetId : null,
      context_policy_id: key === 'policyId' ? targetId : null,
      revision: Number(decision.revision ?? 0) + 1,
      updated_at: at,
      updated_by: options.actorId,
    })
    appendDecisionEvent(this.store, tenant, decisionId, 'context-linked', String(decision.status ?? 'proposed'), String(decision.status ?? 'proposed'), options.actorId)
    return updated as ContentRecord
  }
}

/**
 * E05: an observation is the authority and the metric row is its projection;
 * a failed observation append leaves the projection untouched.
 */
export class MetricRepository extends BaseRepository<ContentRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_metrics')
  }

  async observe(tenantId: TenantId, metricId: string, value: number, options: WriteOptions): Promise<ContentRecord> {
    const tenant = requireTenant(tenantId)
    if (!options || typeof options.actorId !== 'string' || !options.actorId.trim()) {
      throw new MalformedQueryError('actorId is required')
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new MalformedQueryError('value must be a finite number')
    const metric = this.store.findById(this.table, tenant, metricId)
    if (!metric) throw new NotFoundError()
    if (this.store.consumeAuditFault('metric.observe', 'qs_metric_observations')) throw new AuditWriteFailedError()

    const at = this.store.clock.now()
    this.store.insert('qs_metric_observations', {
      tenant_id: tenant,
      id: this.store.ids.next('obs'),
      metric_id: metricId,
      value,
      observed_at: at,
      actor_id: options.actorId,
    })
    return this.store.replace(this.table, tenant, metricId, {
      value,
      revision: Number(metric.revision ?? 0) + 1,
      updated_at: at,
      updated_by: options.actorId,
    }) as ContentRecord
  }
}

/** B08: one CAS winner per head, and a failed audit append leaves the head alone. */
export class WorkflowPublicationHeadRepository extends BaseRepository<ContentRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_workflow_publication_heads')
  }

  async cas(tenantId: TenantId, graphId: string, expectedCasRevision: number, activeVersion: number, options: WriteOptions): Promise<ContentRecord> {
    return casPublicationHead(this.store, tenantId, graphId, expectedCasRevision, activeVersion, options, {
      headTable: 'qs_workflow_publication_heads',
      keyColumn: 'graph_id',
      versionTable: 'qs_automation_workflows',
      versionColumn: 'graph_id',
      auditTable: 'qs_workflow_publication_audits',
      auditEvent: 'publication-head-moved',
    })
  }
}

export class AgentPublicationHeadRepository extends BaseRepository<ContentRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_agent_publication_heads')
  }

  async cas(tenantId: TenantId, agentId: string, expectedCasRevision: number, activeVersion: number, options: WriteOptions): Promise<ContentRecord> {
    return casPublicationHead(this.store, tenantId, agentId, expectedCasRevision, activeVersion, options, {
      headTable: 'qs_agent_publication_heads',
      keyColumn: 'agent_id',
      versionTable: 'qs_agent_definitions',
      versionColumn: 'agent_id',
      auditTable: 'qs_agent_publication_audits',
      auditEvent: 'agent-publication-head-moved',
    })
  }
}

function casPublicationHead(
  store: CmsStore,
  tenantId: TenantId,
  keyValue: string,
  expectedCasRevision: number,
  activeVersion: number,
  options: WriteOptions,
  config: { headTable: string; keyColumn: string; versionTable: string; versionColumn: string; auditTable: string; auditEvent: string },
): ContentRecord {
  const tenant = requireTenant(tenantId)
  if (!options || typeof options.actorId !== 'string' || !options.actorId.trim()) {
    throw new MalformedQueryError('actorId is required')
  }
  if (!Number.isInteger(expectedCasRevision)) throw new MalformedQueryError('expectedCasRevision is required')
  if (!Number.isInteger(activeVersion)) throw new MalformedQueryError('activeVersion is required')

  const head = store.rows(config.headTable).find((row) => row.tenant_id === tenant && row[config.keyColumn] === keyValue)
  if (!head) throw new NotFoundError()

  const version = store
    .rows(config.versionTable)
    .find((row) => row.tenant_id === tenant && row[config.versionColumn] === keyValue && Number(row.version) === activeVersion)
  if (!version) {
    // The version is keyed by (tenant, graph/agent, version), so a same-number
    // version that exists only in another tenant is the cross-tenant case.
    const foreign = store
      .rows(config.versionTable)
      .some(
        (row) =>
          row.tenant_id !== tenant && row[config.versionColumn] === keyValue && Number(row.version) === activeVersion,
      )
    if (foreign) throw new CrossTenantRelationError()
    throw new UnresolvedRelationError()
  }

  if (Number(head.cas_revision) !== expectedCasRevision) throw new RevisionConflictError()
  if (store.consumeAuditFault('publication.cas', config.auditTable)) throw new AuditWriteFailedError()

  const at = store.clock.now()
  const updated = store.replace(config.headTable, tenant, String(head.id), {
    active_version: activeVersion,
    cas_revision: expectedCasRevision + 1,
    updated_at: at,
  })
  store.insert(config.auditTable, {
    tenant_id: tenant,
    id: store.ids.next('aud'),
    seq: store.rows(config.auditTable).filter((row) => row.tenant_id === tenant).length + 1,
    event: config.auditEvent,
    [config.keyColumn]: keyValue,
    version: activeVersion,
    actor_id: options.actorId,
    at,
    detail: null,
  })
  return updated as ContentRecord
}

/** B09: operator records link only to same-tenant targets. */
export class CommitmentRepository extends BaseRepository<ContentRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_commitments')
  }

  async linkDecision(tenantId: TenantId, id: string, decisionId: string, options: WriteOptions): Promise<void> {
    link(this.store, tenantId, 'commitment.linkedDecision', id, decisionId, options)
  }
}

export class ScheduledItemRepository extends BaseRepository<ContentRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_scheduled_items')
  }

  async linkCommitment(tenantId: TenantId, id: string, commitmentId: string, options: WriteOptions): Promise<void> {
    link(this.store, tenantId, 'scheduledItem.linkedCommitment', id, commitmentId, options)
  }

  async linkDecision(tenantId: TenantId, id: string, decisionId: string, options: WriteOptions): Promise<void> {
    link(this.store, tenantId, 'scheduledItem.linkedDecision', id, decisionId, options)
  }

  async linkContact(tenantId: TenantId, id: string, contactId: string, options: WriteOptions): Promise<void> {
    link(this.store, tenantId, 'scheduledItem.linkedContact', id, contactId, options)
  }
}

export class DraftedCommunicationRepository extends BaseRepository<ContentRecord> {
  constructor(store: CmsStore) {
    super(store, 'qs_drafted_communications')
  }

  async linkContact(tenantId: TenantId, id: string, contactId: string, options: WriteOptions): Promise<void> {
    link(this.store, tenantId, 'draftedCommunication.contact', id, contactId, options)
  }

  async linkCommitment(tenantId: TenantId, id: string, commitmentId: string, options: WriteOptions): Promise<void> {
    link(this.store, tenantId, 'draftedCommunication.commitment', id, commitmentId, options)
  }

  async linkDecision(tenantId: TenantId, id: string, decisionId: string, options: WriteOptions): Promise<void> {
    link(this.store, tenantId, 'draftedCommunication.decision', id, decisionId, options)
  }
}

/** Derived and audit stores have no update or delete path (§4, C08). */
export class AppendOnlyRepository extends BaseRepository<ContentRecord> {
  async update(): Promise<never> {
    throw new AppendOnlyViolationError()
  }

  async archive(): Promise<never> {
    throw new AppendOnlyViolationError()
  }

  async softDelete(): Promise<never> {
    throw new AppendOnlyViolationError()
  }

  async restore(): Promise<never> {
    throw new AppendOnlyViolationError()
  }

  async hardDelete(): Promise<never> {
    throw new AppendOnlyViolationError()
  }
}

/** E07: the audit store's only write is an append, and its failure is surfaced. */
export class DepartmentAuditRepository extends AppendOnlyRepository {
  constructor(store: CmsStore) {
    super(store, 'qs_department_execution_audits')
  }

  async append(tenantId: TenantId, entry: Record<string, unknown>, options: WriteOptions): Promise<Record<string, unknown>> {
    const tenant = requireTenant(tenantId)
    if (!options || typeof options.actorId !== 'string' || !options.actorId.trim()) {
      throw new MalformedQueryError('actorId is required')
    }
    if (this.store.consumeAuditFault('department.execution-audit', this.table)) throw new AuditWriteFailedError()
    const at = this.store.clock.now()
    const row = {
      ...entry,
      tenant_id: tenant,
      id: this.store.ids.next('dea'),
      executed_at: at,
      actor_id: options.actorId,
    }
    this.store.insert(this.table, row)
    return structuredClone(row)
  }
}

export type RepositoryMap = Record<string, BaseRepository<ContentRecord>>

/** Constructs one repository per catalog store; A02 requires all of them. */
export function createRepositories(store: CmsStore): RepositoryMap {
  const specialized: Record<string, new (store: CmsStore) => BaseRepository<ContentRecord>> = {
    OrganizationRepository,
    ObjectiveRepository,
    DepartmentRepository,
    CapabilityRepository,
    DecisionRepository,
    WorkflowPublicationHeadRepository,
    AgentPublicationHeadRepository,
    CommitmentRepository,
    ScheduledItemRepository,
    DraftedCommunicationRepository,
    MetricRepository,
    DepartmentAuditRepository,
  }
  const repositories: RepositoryMap = {}
  for (const definition of C1_STORES) {
    const Specialized = specialized[definition.repository]
    repositories[definition.repository] = Specialized
      ? new Specialized(store)
      : definition.kind === 'derived'
        ? new AppendOnlyRepository(store, definition.name)
        : new BaseRepository<ContentRecord>(store, definition.name)
  }
  return repositories
}
