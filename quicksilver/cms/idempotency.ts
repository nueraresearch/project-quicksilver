/**
 * Tenant-scoped idempotency keys (schema and repository map §2.4).
 *
 * The key records the normalized request digest and the response that the
 * original call produced. A repeat with the same digest replays that response
 * and never re-enters the body, so a retried create cannot write a second row
 * or a second revision. A different digest under the same key is a conflict.
 *
 * The key row and the body's writes commit together: a transaction that fails
 * leaves neither, so its retry is a first attempt. That is why the body is
 * synchronous — a commit cannot span an await.
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

function clone<T>(value: T): T {
  return structuredClone(value)
}

export async function runIdempotent<T>(
  store: Store,
  tenantId: TenantId,
  operation: string,
  key: string,
  request: unknown,
  body: () => T,
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

  // The body runs inside the transaction, so the record, its revision and the
  // key are one commit. Because the body is synchronous, two callers with the
  // same key cannot interleave: the second one finds the completed key row and
  // replays it (§6 D04).
  const committed = store.atomically(() => {
    const result = body()
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
    return { result, responseDigest }
  })

  return { result: committed.result, requestDigest, responseDigest: committed.responseDigest, replayed: false }
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
