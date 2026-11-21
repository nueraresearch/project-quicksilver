/**
 * The C1 store used by the acceptance suite.
 *
 * The matrix (§2.3) allows exactly these substitutions around a real repository
 * boundary: a fixed clock, a deterministic id source, a read-only `rawDump`, a
 * fail-audit seam, and a two-operation barrier. Nothing else is faked, so a
 * passing case is evidence about repository behaviour rather than about a mock.
 *
 * This is an in-memory adapter, not a persistence choice: C1 sign-off still
 * requires the selected adapter, and a green suite here is repository evidence,
 * not migration evidence.
 */
import { createHash } from 'node:crypto'

import { MalformedQueryError } from './errors.ts'
import { C1_INTERNAL_TABLES, C1_STORES } from './catalog.ts'

/** Fixed by the matrix so assertions never depend on the wall clock. */
export const FIXED_NOW = '2026-01-01T00:00:00.000Z'

export type StoredRow = Record<string, unknown>

/** Stable ordering and timestamps: one tick per call, starting at FIXED_NOW. */
export class DeterministicClock {
  private ticks = 0

  now(): string {
    return new Date(Date.parse(FIXED_NOW) + this.ticks++).toISOString()
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
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Held operations release together, for the CAS races in C02/C07/D04. */
export interface Barrier {
  wait(): Promise<void>
  release(): void
}

export class MemoryStore {
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
