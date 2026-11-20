/**
 * The C1 store used by the acceptance suite.
 *
 * The matrix (§2.3) allows exactly these substitutions around a real repository
 * boundary: a fixed clock, a deterministic id source, a read-only `rawDump`, a
 * fail-audit seam, and a two-operation barrier. Nothing else is faked, so a
 * passing case is evidence about repository behaviour rather than about a mock.
 *
 * This is the fixture adapter. `FileStore` implements the same `CmsStore`
 * surface on disk; the suite still runs against this one for speed, and the
 * durable adapter has its own cases in `tenancy.test.ts` and `bootstrap.test.ts`.
 */
import { createHash } from 'node:crypto'

import { CrossTenantRelationError, MalformedQueryError, NotFoundError, UnresolvedRelationError } from './errors.ts'
import { C1_INTERNAL_TABLES, C1_STORES } from './catalog.ts'
import { requireTenant } from './tenancy.ts'

/** Fixed by the matrix so assertions never depend on the wall clock. */
export const FIXED_NOW = '2026-01-01T00:00:00.000Z'

export type StoredRow = Record<string, unknown>

/** Stable ordering and timestamps: one tick per call, starting at FIXED_NOW. */
export class DeterministicClock {
  private ticks = 0

  now(): string {
    return new Date(Date.parse(FIXED_NOW) + this.ticks++).toISOString()
  }

  /** Ticks consumed so far, so a durable adapter resumes the same sequence. */
  state(): number {
    return this.ticks
  }

  restore(state: number): void {
    if (!Number.isInteger(state) || state < 0) throw new MalformedQueryError('clock state must be a non-negative integer')
    this.ticks = state
  }
}

/** Ids are `prefix_0001`, `prefix_0002`, … per prefix. No randomness. */
export class DeterministicIds {
  private readonly counters = new Map<string, number>()

  next(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, next)
    return `${prefix}_${String(next).padStart(4, '0')}`
  }

  /** Per-prefix counters, so a reload continues instead of reissuing ids. */
  state(): Record<string, number> {
    return Object.fromEntries(this.counters)
  }

  restore(state: Record<string, number>): void {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new MalformedQueryError('id state must be an object of prefix counters')
    }
    for (const [prefix, count] of Object.entries(state)) {
      if (prefix.length === 0 || !Number.isInteger(count) || count < 0) {
        throw new MalformedQueryError('id state must be an object of prefix counters')
      }
      this.counters.set(prefix, count)
    }
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Held operations release together, for the CAS races in C02/C07/D04. */
export interface Barrier {
  wait(): Promise<void>
  release(): void
}

/** One same-tenant edge write: both endpoints, the join table and the row. */
export interface EdgeWrite {
  readonly tenantId: string
  readonly joinTable: string
  readonly sourceTable: string
  readonly sourceId: string
  readonly targetTable: string
  readonly targetId: string
  readonly row: StoredRow
}

/**
 * The surface every repository, relation and query uses. Repositories take this
 * rather than the fixture store, so the durable adapter is the same boundary and
 * the suite exercises the adapter that will serve traffic.
 */
export interface CmsStore {
  readonly clock: DeterministicClock
  readonly ids: DeterministicIds
  tableNames(): string[]
  hasTable(name: string): boolean
  rows(table: string): readonly StoredRow[]
  insert(table: string, row: StoredRow): void
  findById(table: string, tenantId: string, id: string): StoredRow | undefined
  replace(table: string, tenantId: string, id: string, patch: StoredRow): StoredRow
  existsInAnotherTenant(table: string, tenantId: string, id: string): boolean
  rawDump(tenantId: string, table: string): StoredRow[]
  failAuditAppend(operation: string, table: string): void
  consumeAuditFault(operation: string, table: string): boolean
  barrier(participants?: number): Barrier
  /** Composite, same-tenant edge: endpoints are resolved before anything is written. */
  linkEdge(edge: EdgeWrite): StoredRow
}

export class MemoryStore implements CmsStore {
  private readonly tables = new Map<string, StoredRow[]>()
  private readonly auditFaults = new Set<string>()
  readonly clock = new DeterministicClock()
  readonly ids = new DeterministicIds()

  constructor() {
    for (const store of C1_STORES) this.tables.set(store.name, [])
    for (const table of C1_INTERNAL_TABLES) this.tables.set(table, [])
  }

  /** Every registered table, in catalog order. */
  tableNames(): string[] {
    return [...this.tables.keys()]
  }

  hasTable(name: string): boolean {
    return this.tables.has(name)
  }

  rows(table: string): readonly StoredRow[] {
    return this.tables.get(table) ?? []
  }

  /** Throws rather than creating an unknown table, so a typo cannot pass. */
  insert(table: string, row: StoredRow): void {
    const rows = this.tables.get(table)
    if (!rows) throw new MalformedQueryError(`unknown table: ${table}`)
    rows.push(clone(row))
  }

  findById(table: string, tenantId: string, id: string): StoredRow | undefined {
    return this.rows(table).find((row) => row.tenant_id === tenantId && row.id === id)
  }

  /** Replaces one tenant's row in place and returns the stored copy. */
  replace(table: string, tenantId: string, id: string, patch: StoredRow): StoredRow {
    const rows = this.tables.get(table)
    if (!rows) throw new MalformedQueryError(`unknown table: ${table}`)
    const index = rows.findIndex((row) => row.tenant_id === tenantId && row.id === id)
    if (index === -1) throw new MalformedQueryError(`no ${table} row ${id} for ${tenantId}`)
    const next = { ...rows[index], ...patch, tenant_id: tenantId, id }
    rows[index] = clone(next)
    return clone(next)
  }

  /** True when the id exists in some other tenant, for a CrossTenantRelation. */
  existsInAnotherTenant(table: string, tenantId: string, id: string): boolean {
    return this.rows(table).some((row) => row.id === id && row.tenant_id !== tenantId)
  }

  /**
   * Writes one same-tenant composite edge. The source must resolve in the
   * tenant, the target must resolve in the tenant, and (tenant, join table,
   * from, to) is the composite key, so a repeated link returns the existing row
   * instead of a second edge. A foreign target is refused before any write.
   */
  linkEdge({ tenantId, joinTable, sourceTable, sourceId, targetTable, targetId, row }: EdgeWrite): StoredRow {
    const tenant = requireTenant(tenantId)
    if (!this.hasTable(joinTable)) throw new MalformedQueryError(`unknown table: ${joinTable}`)
    if (typeof sourceId !== 'string' || sourceId.trim().length === 0) throw new MalformedQueryError('sourceId is required')
    if (typeof targetId !== 'string' || targetId.trim().length === 0) throw new MalformedQueryError('targetId is required')
    if (!this.findById(sourceTable, tenant, sourceId)) throw new NotFoundError()
    if (!this.findById(targetTable, tenant, targetId)) {
      if (this.existsInAnotherTenant(targetTable, tenant, targetId)) throw new CrossTenantRelationError()
      throw new UnresolvedRelationError()
    }
    const existing = this.rows(joinTable).find(
      (candidate) => candidate.tenant_id === tenant && candidate.from_id === sourceId && candidate.to_id === targetId,
    )
    if (existing) return clone(existing)
    const edge: StoredRow = { ...row, tenant_id: tenant, from_id: sourceId, to_id: targetId }
    this.insert(joinTable, edge)
    return clone(edge)
  }

  /** Read-only inspection for the suite: a copy, filtered to one tenant. */
  rawDump(tenantId: string, table: string): StoredRow[] {
    if (typeof tenantId !== 'string' || !tenantId.trim()) {
      throw new MalformedQueryError('rawDump requires a tenant')
    }
    if (!this.tables.has(table)) throw new MalformedQueryError(`unknown table: ${table}`)
    return this.rows(table)
      .filter((row) => row.tenant_id === tenantId)
      .map((row) => clone(row))
  }

  /** Fail the next matching audit append while the primary write proceeds. */
  failAuditAppend(operation: string, table: string): void {
    this.auditFaults.add(`${operation}:${table}`)
  }

  /** True once, for the operation that was told to fail. */
  consumeAuditFault(operation: string, table: string): boolean {
    return this.auditFaults.delete(`${operation}:${table}`)
  }

  barrier(participants = 2): Barrier {
    let arrived = 0
    let open = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = () => {
        open = true
        resolve()
      }
    })
    return {
      wait: () => {
        arrived += 1
        if (arrived >= participants) release()
        return open ? Promise.resolve() : gate
      },
      release,
    }
  }
}

/** SHA-256 over canonical JSON, used for revision and response digests. */
export function digestOf(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
