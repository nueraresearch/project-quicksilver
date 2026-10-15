/**
 * The one place the web app creates Sanity clients (threat model A-7).
 *
 * - `getSanityClient('read')`: pages and routes that only read (the decision
 *   log). Uses `SANITY_READ_TOKEN`, a Viewer token that cannot write.
 * - `getSanityClient('write')`: routes that create or patch documents (plan,
 *   the decision routes, evaluation records). Uses `SANITY_WRITE_TOKEN`, an
 *   Editor token.
 *
 * Either falls back to the legacy combined `SANITY_AUTH_TOKEN` with a warning
 * printed once per server process, and a read uses no token at all when the
 * founder has marked the dataset public (`SANITY_DATASET_PUBLIC=on`). The
 * choice itself is `resolveSanityToken` in @quicksilver/kernel/sanity-tokens,
 * shared with the host. The legacy challenge project stays refused
 * (`getDedicatedSanityProjectId`). Server-only: never import this from a
 * client component.
 */
import { createClient, type SanityClient } from '@sanity/client'
import { createOnceWarner, resolveSanityToken, type SanityAccess } from '@quicksilver/kernel/sanity-tokens'
import { getDedicatedSanityProjectId } from './sanity-config'

const warnOnce = createOnceWarner((message) => console.warn(`[sanity] ${message}`))

/**
 * What an empty dataset really returns for a given query shape, P-118.
 *
 * Three shapes, and getting one wrong turns a correct route into a false
 * failure:
 *
 * - a GROQ object literal (`{ "proposed": count(...) }`) returns an object;
 * - a single-document form (`*[...][0]`) returns `null`;
 * - every other list query returns `[]`.
 *
 * The list case matters because `capRows` and friends call `.slice()` on the
 * result: handing a list route an object throws, the route refuses, and a
 * handler that refuses proves nothing about its declared response schema.
 */
const SINGLE_DOCUMENT_FORM = /\[\s*0\s*\]\s*(\{|$)/
const OBJECT_KEY = /"([^"]+)"\s*:/g

function emptyResultFor(query: string): unknown {
  const trimmed = query.trim()
  if (trimmed.startsWith('{')) {
    // A GROQ object literal. In real Sanity every named key is always present
    // — `count(...)` yields 0 — so an empty dataset still answers
    // `{ "spendUsd": 0, "entryCount": 0 }`. Returning a bare `{}` would strip
    // required properties and report a correct route as a contract violation.
    const result: Record<string, number> = {}
    for (const match of trimmed.matchAll(OBJECT_KEY)) result[match[1]!] = 0
    return result
  }
  return SINGLE_DOCUMENT_FORM.test(query) ? null : []
}

/** A no-op patch builder: `ifRevisionId` and `set` chain and return the patch. */
function mockPatch(): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const method of ['ifRevisionId', 'set', 'setIfMissing', 'unset', 'inc', 'dec']) {
    patch[method] = () => patch
  }
  return patch
}

/** A chainable no-op transaction, so a write route runs its full success path. */
function mockTransaction(): Record<string, unknown> {
  const tx: Record<string, unknown> = {}
  for (const method of ['create', 'createIfNotExists', 'createOrReplace', 'delete']) {
    tx[method] = () => tx
  }
  tx.patch = (_id: string, apply?: (patch: unknown) => unknown) => {
    apply?.(mockPatch())
    return tx
  }
  tx.commit = async () => ({ transactionId: 'quicksilver-mock', results: [] })
  return tx
}

/**
 * A client that never reaches Sanity.
 *
 * This exists so the credential-free regression chain can exercise a route's
 * *success* path rather than only its refusal. Returning `{}` for every query,
 * as the first version did, was not enough: list handlers call `.slice()` on the
 * result, so they threw and refused, and a handler that refuses proves nothing
 * about its declared response schema.
 *
 * Reads answer with what an empty dataset really returns; writes are accepted
 * and discarded. That is enough for a list route to serve its genuine empty
 * success shape.
 *
 * It is deliberately *not* a fixture library: there are no seeded documents, so
 * this verifies each response's envelope, required properties and scalar types,
 * not the shape of array elements. Routes whose success payload is built from
 * non-storage data (the built-in agent manifests, for one) do get real element
 * coverage. Anything deeper needs real fixtures.
 */
function mockSanityClient(): SanityClient {
  const read = async (query: string) => emptyResultFor(query)
  const write = async () => ({})
  return {
    fetch: read,
    query: read,
    transaction: mockTransaction,
    create: write,
    createIfNotExists: write,
    createOrReplace: write,
    patch: write,
    delete: write,
  } as unknown as SanityClient
}

export function getSanityClient(access: SanityAccess): SanityClient {
  if (process.env.QS_SANITY_MOCK) {
    // Fail closed rather than serve invented data. A mock that silently reached
    // a production deployment would answer every Sanity-backed route with an
    // empty result and still look healthy.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('QS_SANITY_MOCK is a test-only flag and must not be set in production.')
    }
    return mockSanityClient()
  }

  const projectId = getDedicatedSanityProjectId()
  const choice = warnOnce(resolveSanityToken(access, process.env))
  return createClient({
    projectId,
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
    apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION ?? '2024-10-01',
    useCdn: false,
    ...(choice.token ? { token: choice.token } : {}),
  })
}