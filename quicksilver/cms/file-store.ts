/**
 * The first durable C1 store adapter: a versioned snapshot on local disk.
 *
 * This exists because C1's green suite runs on `MemoryStore`, and a suite that
 * only ever runs on an in-memory fixture cannot answer the question the cutover
 * asks — whether the content model survives a process. Everything the
 * repository layer asserts still holds here, because the repositories are typed
 * against `Store`, not against the fixture.
 *
 * What it guarantees, and why each guarantee has a test:
 *
 * - **Reopen.** Rows written by one `FileStore` are readable by the next one
 *   over the same directory.
 * - **Atomic replace.** A write goes to `snapshot.json.tmp`, is fsynced, and is
 *   renamed over the snapshot. A reader never sees a half-written file, and a
 *   failed write leaves the previous snapshot as the only one.
 * - **Rolled-back memory.** If the write fails, the in-memory tables are
 *   reloaded from disk before the error is rethrown, so a failed save cannot
 *   leave the process believing in rows that were never persisted.
 * - **Ids that continue.** Id counters are seeded from the loaded rows, so a
 *   reopen cannot hand out `org_0001` a second time.
 * - **One commit per write.** `atomically` defers every table mutation in a
 *   repository write to a single snapshot, and undoes all of them if the write
 *   throws, so a record and its revision cannot be persisted apart. Undoing
 *   reseeds the tables and reloads the last snapshot, which also reseeds the id
 *   counters, so a rolled-back write consumes no id.
 * - **Fail closed on corruption.** A truncated, malformed or unknown-table
 *   snapshot refuses to open. Reading it as an empty store would silently
 *   discard the content the cutover depends on.
 *
 * What it is not: a database. The whole snapshot is rewritten per mutation, so
 * this is a single-process adapter for the first native deployments and tests.
 * A server-backed adapter must satisfy the same `Store` interface; nothing in
 * the repository layer assumes this one.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'

import { C1_INTERNAL_TABLES, C1_STORES } from './catalog.ts'
import { MalformedQueryError } from './errors.ts'
import {
  createBarrier,
  type Barrier,
  type Clock,
  type IdSource,
  type Store,
  type StoredRow,
} from './store.ts'

/** The snapshot filename inside the store root. */
export const SNAPSHOT_FILE = 'snapshot.json'

/** Bumped only by a format change that an existing snapshot cannot be read as. */
const FORMAT_VERSION = 1

/** The wall clock, for a real install. Tests inject `DeterministicClock`. */
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString()
  }
}

/** A save or load that could not be completed. Never a quietly empty result. */
export class StorePersistenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorePersistenceError'
  }
}

/**
 * Ids continue across reopen: the counters are seeded from the loaded rows, so
 * a restart cannot reissue an id that a foreign key already points at.
 */
class DurableIds implements IdSource {
  private readonly counters = new Map<string, number>()

  next(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, next)
    return `${prefix}_${String(next).padStart(4, '0')}`
  }

  /** Clears every counter, so a reload reseeds them from the rows on disk. */
  reset(): void {
    this.counters.clear()
  }

  /** Seed a counter from an existing id, e.g. `org_0007` → at least 7. */
  observe(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const id = (value as StoredRow).id
    if (typeof id !== 'string') return
    const match = /^(.*)_(\d+)$/.exec(id)
    if (!match) return
    const seen = Number(match[2])
    if (!Number.isSafeInteger(seen)) return
    this.counters.set(match[1], Math.max(this.counters.get(match[1]) ?? 0, seen))
  }
}

export interface FileStoreOptions {
  /** Directory holding `snapshot.json`. Created if absent. */
  root: string
  /** Defaults to the system clock. */
  clock?: Clock
}

export class FileStore implements Store {
  readonly clock: Clock
  readonly ids: DurableIds
  private readonly root: string
  private readonly snapshotPath: string
  private readonly tables = new Map<string, StoredRow[]>()
  private readonly auditFaults = new Set<string>()
  private failNextSaveOnce = false
  /** >0 while a transaction is open, so writes defer to its single commit. */
  private depth = 0
  /** Snapshot commits, for tests that count them. */
  private saves = 0

  constructor(options: FileStoreOptions) {
    this.root = options.root
    this.clock = options.clock ?? new SystemClock()
    this.ids = new DurableIds()
    this.snapshotPath = join(this.root, SNAPSHOT_FILE)
    mkdirSync(this.root, { recursive: true })
    this.resetTables()
    this.load()
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

  findById(table: string, tenantId: string, id: string): StoredRow | undefined {
    const found = this.rows(table).find((row) => row.tenant_id === tenantId && row.id === id)
    return found ? clone(found) : undefined
  }

  insert(table: string, row: StoredRow): void {
    const rows = this.tables.get(table)
    if (!rows) throw new MalformedQueryError(`unknown table: ${table}`)
    rows.push(clone(row))
    this.ids.observe(row)
    this.persist()
  }

  replace(table: string, tenantId: string, id: string, patch: StoredRow): StoredRow {
    const rows = this.tables.get(table)
    if (!rows) throw new MalformedQueryError(`unknown table: ${table}`)
    const index = rows.findIndex((row) => row.tenant_id === tenantId && row.id === id)
    if (index === -1) throw new MalformedQueryError(`no ${table} row ${id} for ${tenantId}`)
    const next = { ...rows[index], ...patch, tenant_id: tenantId, id }
    rows[index] = clone(next)
    this.persist()
    return clone(next)
  }

  existsInAnotherTenant(table: string, tenantId: string, id: string): boolean {
    return this.rows(table).some((row) => row.id === id && row.tenant_id !== tenantId)
  }

  rawDump(tenantId: string, table: string): StoredRow[] {
    if (typeof tenantId !== 'string' || !tenantId.trim()) {
      throw new MalformedQueryError('rawDump requires a tenant')
    }
    if (!this.tables.has(table)) throw new MalformedQueryError(`unknown table: ${table}`)
    return this.rows(table)
      .filter((row) => row.tenant_id === tenantId)
      .map((row) => clone(row))
  }

  /** The audit seam C1 uses; here it is test-only and never persisted. */
  failAuditAppend(operation: string, table: string): void {
    this.auditFaults.add(`${operation}:${table}`)
  }

  consumeAuditFault(operation: string, table: string): boolean {
    return this.auditFaults.delete(`${operation}:${table}`)
  }

  barrier(participants = 2): Barrier {
    return createBarrier(participants)
  }

  /**
   * One persistence unit: every table the work touches is written once, on
   * return, and every table is put back if the work throws. Nested calls join
   * the outer unit, so a helper cannot commit half of a repository write.
   */
  atomically<T>(work: () => T): T {
    if (this.depth > 0) return work()
    this.depth = 1
    let result: T
    try {
      result = work()
    } catch (error) {
      this.depth = 0
      this.failWith(error)
    }
    this.depth = 0
    try {
      this.persist()
    } catch (error) {
      // `persist` rolls back its own failures; a failure while serialising the
      // document never reaches it, so roll back here too.
      this.failWith(error)
    }
    return result
  }

  /** Snapshot writes committed so far. Tests use it to count commits. */
  snapshotWrites(): number {
    return this.saves
  }

  /** Test seam: the next save fails after the in-memory mutation. */
  failNextSave(): void {
    this.failNextSaveOnce = true
  }

  /** Where the snapshot lives, for backups and for tests. */
  snapshotFile(): string {
    return this.snapshotPath
  }

  private resetTables(): void {
    this.tables.clear()
    for (const store of C1_STORES) this.tables.set(store.name, [])
    for (const table of C1_INTERNAL_TABLES) this.tables.set(table, [])
  }

  private load(): void {
    if (!existsSync(this.snapshotPath)) return
    let raw: string
    try {
      raw = readFileSync(this.snapshotPath, 'utf8')
    } catch (error) {
      throw new StorePersistenceError(`cannot read ${this.snapshotPath}: ${(error as Error).message}`)
    }
    if (!raw.trim()) throw new StorePersistenceError(`${this.snapshotPath} is empty`)
    let doc: unknown
    try {
      doc = JSON.parse(raw)
    } catch (error) {
      throw new StorePersistenceError(`${this.snapshotPath} is not valid JSON: ${(error as Error).message}`)
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new StorePersistenceError(`${this.snapshotPath} must contain a JSON object`)
    }
    const snapshot = doc as { formatVersion?: unknown; tables?: unknown }
    if (snapshot.formatVersion !== FORMAT_VERSION) {
      throw new StorePersistenceError(
        `${this.snapshotPath} has formatVersion ${String(snapshot.formatVersion)}; this build reads ${FORMAT_VERSION}`,
      )
    }
    if (!snapshot.tables || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables)) {
      throw new StorePersistenceError(`${this.snapshotPath} has no tables object`)
    }
    for (const [name, rows] of Object.entries(snapshot.tables as Record<string, unknown>)) {
      const target = this.tables.get(name)
      // An unknown table means the file came from a newer catalog or another
      // product. Ignoring it would silently drop that data.
      if (!target) throw new StorePersistenceError(`${this.snapshotPath} contains unknown table: ${name}`)
      if (!Array.isArray(rows)) throw new StorePersistenceError(`${this.snapshotPath} table ${name} is not an array`)
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          throw new StorePersistenceError(`${this.snapshotPath} table ${name} has a non-object row`)
        }
        target.push(clone(row as StoredRow))
        this.ids.observe(row)
      }
    }
  }

  /**
   * Roll back to the last committed snapshot: drop every table, reseed them from
   * the catalog, reload, then reseed the id counters from the rows just read.
   *
   * This replaces copying every table before a write. The copy cost a full clone
   * of the store per mutation and could only describe memory; a reload describes
   * what is actually on disk, which is the state a rollback has to return to.
   * A rollback that cannot read the snapshot is surfaced rather than swallowed:
   * the process must not continue believing either state.
   */
  private failWith(error: unknown): never {
    try {
      this.ids.reset()
      this.resetTables()
      this.load()
    } catch (reloadError) {
      throw new StorePersistenceError(
        `could not roll back to the last snapshot after "${(error as Error)?.message ?? String(error)}": ${(reloadError as Error).message}`,
      )
    }
    throw error
  }

  private document(): string {
    const tables: Record<string, StoredRow[]> = {}
    for (const [name, rows] of this.tables) tables[name] = rows.map((row) => clone(row))
    return JSON.stringify({ formatVersion: FORMAT_VERSION, tables })
  }

  private persist(): void {
    // Inside a transaction the commit writes once, for every table.
    if (this.depth > 0) return
    if (this.failNextSaveOnce) {
      this.failNextSaveOnce = false
      this.failWith(new StorePersistenceError('injected save failure'))
    }
    const payload = this.document()
    const temporary = `${this.snapshotPath}.tmp`
    try {
      const handle = openSync(temporary, 'w')
      try {
        writeSync(handle, payload)
        fsyncSync(handle)
      } finally {
        closeSync(handle)
      }
      renameSync(temporary, this.snapshotPath)
      this.syncDirectory()
      this.saves += 1
    } catch (error) {
      this.failWith(new StorePersistenceError(`could not persist ${this.snapshotPath}: ${(error as Error).message}`))
    }
  }

  /** Make the rename durable. Not every filesystem supports this; the write succeeded. */
  private syncDirectory(): void {
    let handle: number | undefined
    try {
      handle = openSync(this.root, 'r')
      fsyncSync(handle)
    } catch {
      // Directory fsync is a durability hint; the rename already happened.
    } finally {
      if (handle !== undefined) closeSync(handle)
    }
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
