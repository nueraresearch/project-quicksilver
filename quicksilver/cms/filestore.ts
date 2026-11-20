/**
 * The durable C1 adapter (C1 exit: a production persistence adapter behind the
 * existing repository boundary).
 *
 * It implements the same `CmsStore` surface as the fixture store, so every
 * repository, relation and query runs unchanged. What it adds is durability: a
 * mutation is on disk, fsynced and renamed into place, before the call returns.
 *
 * Design notes, deliberately narrow:
 *
 * - **One writer.** A snapshot is rewritten per mutation and swapped with
 *   `rename`, which is atomic on a POSIX filesystem. Two processes writing the
 *   same path are not supported, and the adapter does not pretend otherwise.
 * - **Fail closed.** A corrupt or foreign snapshot refuses to open instead of
 *   starting empty. Starting empty over an unreadable file would look like a
 *   successful bootstrap and then lose content.
 * - **Deterministic state travels with the rows.** Id counters and clock ticks
 *   are part of the snapshot, so a reload cannot reissue an id that is already
 *   stored.
 * - **Tenant rules are not optional here.** `linkEdge` is inherited from the
 *   store container, so the same same-tenant checks run against the durable
 *   adapter; a foreign edge refuses before `insert` can persist anything.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

import { MemoryStore, type StoredRow } from './store.ts'

/** Bumped only with a migration; an unknown version refuses rather than guesses. */
const SNAPSHOT_VERSION = 1

export interface FileStoreSnapshot {
  version: number
  tables: Record<string, StoredRow[]>
  clock: number
  ids: Record<string, number>
}

/** Storage problems are not repository refusals: they never look like `NotFound`. */
export class PersistenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceError'
  }
}

export class FileStore extends MemoryStore {
  readonly path: string

  constructor(path: string) {
    super()
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new PersistenceError('a store path is required')
    }
    this.path = path
    if (existsSync(path)) this.load()
  }

  /** Every committed write is durable when this returns. */
  override insert(table: string, row: StoredRow): void {
    super.insert(table, row)
    this.persist()
  }

  override replace(table: string, tenantId: string, id: string, patch: StoredRow): StoredRow {
    const next = super.replace(table, tenantId, id, patch)
    this.persist()
    return next
  }

  /** The exact bytes written: stable table and key order, so a diff is readable. */
  snapshot(): string {
    const tables: Record<string, StoredRow[]> = {}
    for (const table of this.tableNames()) tables[table] = this.rows(table).map((row) => structuredClone(row))
    const value: FileStoreSnapshot = {
      version: SNAPSHOT_VERSION,
      tables,
      clock: this.clock.state(),
      ids: this.ids.state(),
    }
    return `${JSON.stringify(value, null, 2)}\n`
  }

  persist(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    const handle = openSync(temporary, 'w')
    try {
      writeSync(handle, this.snapshot())
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    renameSync(temporary, this.path)
    // Persist the rename itself. Some filesystems refuse to fsync a directory;
    // that is not a reason to fail a committed write.
    try {
      const directory = openSync(dirname(this.path), 'r')
      try {
        fsyncSync(directory)
      } finally {
        closeSync(directory)
      }
    } catch {
      /* directory fsync is best-effort */
    }
  }

  private load(): void {
    let text: string
    try {
      text = readFileSync(this.path, 'utf8')
    } catch (error) {
      throw new PersistenceError(`refusing to start: cannot read ${this.path}: ${(error as Error).message}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new PersistenceError(`refusing to start: ${this.path} is not valid JSON`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new PersistenceError(`refusing to start: ${this.path} is not a store snapshot`)
    }
    const snapshot = parsed as Partial<FileStoreSnapshot>
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new PersistenceError(`refusing to start: ${this.path} has snapshot version ${String(snapshot.version)}`)
    }
    if (!snapshot.tables || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables)) {
      throw new PersistenceError(`refusing to start: ${this.path} has no table map`)
    }

    for (const [table, rows] of Object.entries(snapshot.tables)) {
      if (!this.hasTable(table)) throw new PersistenceError(`refusing to start: ${this.path} names unknown table ${table}`)
      if (!Array.isArray(rows)) throw new PersistenceError(`refusing to start: ${table} is not a row array`)
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          throw new PersistenceError(`refusing to start: ${table} holds a row that is not an object`)
        }
        super.insert(table, row as StoredRow)
      }
    }

    this.clock.restore(typeof snapshot.clock === 'number' ? snapshot.clock : 0)
    this.ids.restore(snapshot.ids && typeof snapshot.ids === 'object' ? snapshot.ids : {})
  }
}
