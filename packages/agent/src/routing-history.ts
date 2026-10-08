import { createHash, randomUUID } from 'node:crypto'
import { open, mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import { updateModelPerformance, type ModelPerformanceProfile, type RoutingOutcome } from '@quicksilver/kernel'

const GENESIS = '0'.repeat(64)
const MAX_HISTORY_BYTES = 5 * 1024 * 1024
const MAX_HISTORY_ENTRIES = 10_000
const LOCK_ATTEMPTS = 100
const LOCK_DELAY_MS = 10

export interface RoutingOutcomeEntry {
  kind: 'outcome'
  sequence: number
  recordedAt: string
  outcome: RoutingOutcome
  previousDigest: string
  digest: string
}

export interface RoutingRollbackEntry {
  kind: 'rollback'
  sequence: number
  recordedAt: string
  targetSequence: number
  reviewedBy: string
  reason: string
  previousDigest: string
  digest: string
}

export type RoutingHistoryEntry = RoutingOutcomeEntry | RoutingRollbackEntry

interface RoutingHistoryDocument {
  schemaVersion: 1
  baselineDigest: string
  entries: RoutingHistoryEntry[]
  digest: string
}

export class RoutingHistoryIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoutingHistoryIntegrityError'
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateOutcome(value: unknown, profiles: readonly ModelPerformanceProfile[]): value is RoutingOutcome {
  if (!isObject(value)) return false
  const knownTasks = new Set(profiles.flatMap((profile) => profile.supportedTasks))
  return typeof value.modelId === 'string' && profiles.some((profile) => profile.modelId === value.modelId)
    && typeof value.taskType === 'string' && knownTasks.has(value.taskType as RoutingOutcome['taskType'])
    && typeof value.success === 'boolean'
    && typeof value.latencyMs === 'number' && Number.isFinite(value.latencyMs) && value.latencyMs >= 0
    && (value.measuredAccuracy === undefined || typeof value.measuredAccuracy === 'number' && Number.isFinite(value.measuredAccuracy) && value.measuredAccuracy >= 0 && value.measuredAccuracy <= 1)
    && (value.domain === undefined || typeof value.domain === 'string')
    && (value.costPer1kTokens === undefined || typeof value.costPer1kTokens === 'number' && Number.isFinite(value.costPer1kTokens) && value.costPer1kTokens >= 0)
    && (value.rateLimited === undefined || typeof value.rateLimited === 'boolean')
}

function validateEntry(value: unknown, sequence: number, previousDigest: string, profiles: readonly ModelPerformanceProfile[]): value is RoutingHistoryEntry {
  if (!isObject(value) || value.sequence !== sequence || value.previousDigest !== previousDigest
    || typeof value.recordedAt !== 'string' || !Number.isFinite(Date.parse(value.recordedAt))
    || typeof value.digest !== 'string') return false
  const { digest: suppliedDigest, ...core } = value
  if (digest(core) !== suppliedDigest) return false
  if (value.kind === 'outcome') return validateOutcome(value.outcome, profiles)
  return value.kind === 'rollback'
    && Number.isInteger(value.targetSequence) && (value.targetSequence as number) >= 0 && (value.targetSequence as number) < sequence
    && typeof value.reviewedBy === 'string' && value.reviewedBy.trim().length > 0
    && typeof value.reason === 'string' && value.reason.trim().length > 0 && value.reason.length <= 500
}

function baselineDigest(profiles: readonly ModelPerformanceProfile[]): string {
  return digest(profiles)
}

async function readDocument(path: string, profiles: readonly ModelPerformanceProfile[]): Promise<RoutingHistoryDocument> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: 1, baselineDigest: baselineDigest(profiles), entries: [], digest: GENESIS }
    }
    throw error
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_HISTORY_BYTES) throw new RoutingHistoryIntegrityError('Routing history exceeds the 5 MiB safety limit.')

  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new RoutingHistoryIntegrityError('Routing history is not valid JSON.') }
  if (!isObject(value) || value.schemaVersion !== 1 || value.baselineDigest !== baselineDigest(profiles)
    || !Array.isArray(value.entries) || value.entries.length > MAX_HISTORY_ENTRIES || typeof value.digest !== 'string') {
    throw new RoutingHistoryIntegrityError('Routing history has an invalid schema, exceeds its entry limit, or is bound to a different model-profile baseline.')
  }
  let previousDigest = GENESIS
  const entries: RoutingHistoryEntry[] = []
  for (let index = 0; index < value.entries.length; index += 1) {
    const candidate = value.entries[index]
    if (!validateEntry(candidate, index + 1, previousDigest, profiles)) {
      throw new RoutingHistoryIntegrityError(`Routing history entry ${index + 1} failed validation or digest verification.`)
    }
    entries.push(candidate)
    previousDigest = candidate.digest
  }
  if (value.digest !== previousDigest) throw new RoutingHistoryIntegrityError('Routing history tail digest does not match its entries.')
  return { schemaVersion: 1, baselineDigest: value.baselineDigest, entries, digest: previousDigest }
}

async function withFileLock<T>(path: string, run: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const lockPath = `${path}.lock`
  let lock: Awaited<ReturnType<typeof open>> | undefined
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      lock = await open(lockPath, 'wx', 0o600)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await new Promise((resolve) => setTimeout(resolve, LOCK_DELAY_MS))
    }
  }
  if (!lock) throw new Error('Routing history is busy or has a stale lock; refusing to route without a durable outcome record.')
  try {
    return await run()
  } finally {
    await lock.close()
    await unlink(lockPath)
  }
}

async function writeDocument(path: string, document: RoutingHistoryDocument): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(tempPath, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(document, null, 2))
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tempPath, path)
  } finally {
    await unlink(tempPath).catch(() => {})
  }
}

/** Load measured profiles after verifying and replaying the complete durable event chain. */
export async function loadModelRoutingProfiles(path: string, baseline: readonly ModelPerformanceProfile[]): Promise<ModelPerformanceProfile[]> {
  const document = await readDocument(path, baseline)
  let active: RoutingOutcomeEntry[] = []
  for (const entry of document.entries) {
    if (entry.kind === 'outcome') active.push(entry)
    else active = active.filter((outcome) => outcome.sequence <= entry.targetSequence)
  }
  let profiles = baseline.map((profile) => ({ ...profile, supportedTasks: [...profile.supportedTasks], taskAccuracy: { ...profile.taskAccuracy } }))
  for (const entry of active) {
    profiles = profiles.map((profile) => profile.modelId === entry.outcome.modelId
      ? updateModelPerformance(profile, entry.outcome)
      : profile)
  }
  return profiles
}

/** Append one measured outcome. Concurrent writers are serialized; corruption, stale locks, and changed baselines fail closed. */
export async function appendModelRoutingOutcome(
  path: string,
  baseline: readonly ModelPerformanceProfile[],
  outcome: RoutingOutcome,
  now = new Date(),
): Promise<number> {
  if (!validateOutcome(outcome, baseline)) throw new Error('Routing outcome does not match a configured model and supported task.')
  if (!Number.isFinite(now.getTime())) throw new Error('Routing outcome time is invalid.')
  return withFileLock(path, async () => {
    const current = await readDocument(path, baseline)
    if (current.entries.length >= MAX_HISTORY_ENTRIES) throw new RoutingHistoryIntegrityError('Routing history is full; refusing to overwrite history.')
    const core = {
      kind: 'outcome' as const,
      sequence: current.entries.length + 1,
      recordedAt: now.toISOString(),
      outcome: { ...outcome },
      previousDigest: current.digest,
    }
    const entry: RoutingOutcomeEntry = { ...core, digest: digest(core) }
    await writeDocument(path, { ...current, entries: [...current.entries, entry], digest: entry.digest })
    return entry.sequence
  })
}

/** Append a human-reviewed rollback marker; the immutable audit log remains intact. */
export async function rollbackModelRoutingHistory(
  path: string,
  baseline: readonly ModelPerformanceProfile[],
  request: { targetSequence: number; reviewer: { id: string; kind: 'human' | 'agent' | 'service' }; reason: string },
  now = new Date(),
): Promise<number> {
  if (!Number.isInteger(request.targetSequence) || request.targetSequence < 0
    || request.reviewer.kind !== 'human' || !request.reviewer.id.trim() || !request.reason.trim() || request.reason.length > 500
    || !Number.isFinite(now.getTime())) throw new Error('Routing rollback requires a valid target sequence, named human reviewer, reason, and timestamp.')
  return withFileLock(path, async () => {
    const current = await readDocument(path, baseline)
    if (request.targetSequence >= current.entries.length) throw new Error('Routing rollback target must be an earlier history sequence.')
    if (current.entries.length >= MAX_HISTORY_ENTRIES) throw new RoutingHistoryIntegrityError('Routing history is full; refusing to overwrite history.')
    const core = {
      kind: 'rollback' as const,
      sequence: current.entries.length + 1,
      recordedAt: now.toISOString(),
      targetSequence: request.targetSequence,
      reviewedBy: request.reviewer.id,
      reason: request.reason.trim(),
      previousDigest: current.digest,
    }
    const entry: RoutingRollbackEntry = { ...core, digest: digest(core) }
    await writeDocument(path, { ...current, entries: [...current.entries, entry], digest: entry.digest })
    return entry.sequence
  })
}
