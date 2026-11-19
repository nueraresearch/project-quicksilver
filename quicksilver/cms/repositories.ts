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
import { AuditWriteFailedError, MalformedQueryError, NotFoundError } from './errors.ts'
import { MemoryStore, digestOf, type StoredRow } from './store.ts'

export type TenantId = string

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

/** The one tenant check every repository and query goes through. */
export function requireTenant(tenantId: unknown): TenantId {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new MalformedQueryError('tenantId is required and must not be blank')
  }
  return tenantId
}

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

function findRow(store: MemoryStore, table: string, tenantId: TenantId, id: string): StoredRow | undefined {
  return store.rows(table).find((row) => row.tenant_id === tenantId && row.id === id)
}

/** Tenant-qualified reads shared by every store's repository. */
export class BaseRepository<T extends ContentRecord> {
  protected readonly store: MemoryStore
  readonly table: string

  constructor(store: MemoryStore, table: string) {
    this.store = store
    this.table = table
  }

  async get(tenantId: TenantId, id: string): Promise<T> {
    const tenant = requireTenant(tenantId)
    if (typeof id !== 'string' || id.trim().length === 0) throw new MalformedQueryError('id is required')
    const row = findRow(this.store, this.table, tenant, id)
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
  constructor(store: MemoryStore) {
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
}

export type RepositoryMap = Record<string, BaseRepository<ContentRecord>>

/** Constructs one repository per catalog store; A02 requires all of them. */
export function createRepositories(store: MemoryStore): RepositoryMap {
  const repositories: RepositoryMap = {}
  for (const definition of C1_STORES) {
    repositories[definition.repository] =
      definition.name === 'qs_organizations'
        ? (new OrganizationRepository(store) as unknown as BaseRepository<ContentRecord>)
        : new BaseRepository<ContentRecord>(store, definition.name)
  }
  return repositories
}
