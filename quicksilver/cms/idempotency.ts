/**
 * Tenant-scoped idempotency keys (schema and repository map §2.4).
 *
 * The key records the normalized request digest and the response that the
 * original call produced. A repeat with the same digest replays that response
 * and never re-enters the body, so a retried create cannot write a second row
 * or a second revision. A different digest under the same key is a conflict.
 *
 * The key row is written only after the body succeeds: a transaction that
 * fails before commit leaves no key behind, so its retry is a first attempt.
 */
import { IdempotencyConflictError, MalformedQueryError } from './errors.ts'
import { digestOf, type Store, type StoredRow } from './store.ts'
import { requireTenant, type TenantId } from './tenancy.ts'

/** A key is reusable after this window, at the store's fixed clock. */
const TTL_MS = 24 * 60 * 60 * 1000

export interface IdempotentOutcome<T> {
  result: T
  requestDigest: string
  responseDigest: string
  replayed: boolean
}

/**
 * In-flight requests are held per store, so two callers with the same key wait
 * on one execution instead of racing to write (§6 D04).
 */
const inFlight = new WeakMap<Store, Map<string, Promise<IdempotentOutcome<unknown>>>>()

function clone<T>(value: T): T {
  return structuredClone(value)
}

export async function runIdempotent<T>(
  store: Store,
  tenantId: TenantId,
  operation: string,
  key: string,
  request: unknown,
  body: () => Promise<T>,
): Promise<IdempotentOutcome<T>> {
  const tenant = requireTenant(tenantId)
  if (typeof operation !== 'string' || operation.trim().length === 0) {
    throw new MalformedQueryError('operation is required')
  }
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new MalformedQueryError('idempotencyKey is required')
  }

  const requestDigest = digestOf({ operation, request })
  const existing = store
    .rows('qs_idempotency_keys')
    .find((row) => row.tenant_id === tenant && row.operation === operation && row.key === key)
  const at = store.clock.now()
  // An expired key is treated as absent: the request is a new first attempt.
  const live = existing !== undefined && String(existing.expires_at) > at

  if (live) {
    if (existing.request_digest !== requestDigest) throw new IdempotencyConflictError()
    if (existing.state === 'completed') {
      return {
        result: clone(existing.response as T),
        requestDigest,
        responseDigest: String(existing.response_digest),
        replayed: true,
      }
    }
  }

  let flights = inFlight.get(store)
  if (!flights) {
    flights = new Map()
    inFlight.set(store, flights)
  }
  const flightKey = JSON.stringify([tenant, operation, key])
  const running = flights.get(flightKey)
  if (running) {
    const outcome = await running
    if (outcome.requestDigest !== requestDigest) throw new IdempotencyConflictError()
    return { ...outcome, result: clone(outcome.result as T), replayed: true } as IdempotentOutcome<T>
  }

  // Register the flight before running the body, so a concurrent caller waits
  // on the same execution rather than starting a second one.
  let settle!: { resolve: (outcome: IdempotentOutcome<unknown>) => void; reject: (error: unknown) => void }
  const pending = new Promise<IdempotentOutcome<unknown>>((resolve, reject) => {
    settle = { resolve, reject }
  })
  // A lone caller observes the rejection through its own await; the stored
  // promise still needs a handler so a failure is not an unhandled rejection.
  void pending.catch(() => {})
  flights.set(flightKey, pending)

  try {
    const result = await body()
    const responseDigest = digestOf(result)
    const recordedAt = store.clock.now()
    const record = {
      operation,
      key,
      request_digest: requestDigest,
      response_digest: responseDigest,
      record_id: (result as { id?: unknown }).id ?? null,
      revision: (result as { revision?: unknown }).revision ?? null,
      state: 'completed',
      response: result,
      created_at: recordedAt,
      expires_at: new Date(Date.parse(recordedAt) + TTL_MS).toISOString(),
    }
    // An expired key is replaced in place: the row is the key's slot, so
    // retrying an old key does not accumulate a second row for it.
    if (existing && typeof existing.id === 'string') {
      store.replace('qs_idempotency_keys', tenant, existing.id, record)
    } else {
      store.insert('qs_idempotency_keys', { tenant_id: tenant, id: store.ids.next('idem'), ...record })
    }
    const outcome: IdempotentOutcome<T> = { result, requestDigest, responseDigest, replayed: false }
    settle.resolve(outcome)
    return outcome
  } catch (error) {
    settle.reject(error)
    throw error
  } finally {
    flights.delete(flightKey)
  }
}

/** The stored key row for a tenant, or undefined. Keys never cross tenants. */
export function findIdempotencyKey(
  store: Store,
  tenantId: TenantId,
  operation: string,
  key: string,
): StoredRow | undefined {
  const tenant = requireTenant(tenantId)
  return store
    .rows('qs_idempotency_keys')
    .find((row) => row.tenant_id === tenant && row.operation === operation && row.key === key)
}
