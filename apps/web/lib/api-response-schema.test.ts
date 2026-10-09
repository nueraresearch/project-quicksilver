import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { register } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'

// Route modules import `next/server` and use the `@/` alias, neither of which
// plain Node ESM resolves. app-routes.test.ts registers the same loader for
// exactly this reason; reuse it rather than duplicating resolution rules.
register('./route-test-loader.mjs', import.meta.url)

// P-118: the API has a declared, versioned, stable contract.
//
// app-routes.test.ts proves the declared paths and methods match the exported
// handlers, and that every $ref resolves. This test closes the remaining gap:
// it calls the handlers and validates the JSON they actually return against the
// response schema the contract declares, so a handler and its schema cannot
// drift apart silently.
//
// OpenAPI 3.1 response schemas are JSON Schema 2020-12, which is why this uses
// ajv's 2020 dialect rather than the default draft-07 build.

/**
 * Operations that return a success response but do not yet declare one in
 * docs/api/openapi.json.
 *
 * The parity matrix claims every operation declares a named success response
 * schema; this test found 14 that do not, so that claim is too strong. Rather
 * than let the gap pass unnoticed or block every contract edit, the debt is
 * pinned here. Adding a new undeclared operation fails immediately; removing a
 * declared schema fails immediately. The list only ever shrinks.
 *
 * Remove an entry when its schema is added to the contract.
 */
const OPERATIONS_AWAITING_A_SUCCESS_SCHEMA = new Set([
  'GET /api/auth/oidc/callback',
  'GET /api/auth/oidc/start',
  'GET /api/decisions/[id]',
  'GET /api/decisions/[id]/audit',
  'POST /api/auth/logout',
  'POST /api/agents/drafts',
  'POST /api/agents/rollback',
  'POST /api/decisions/[id]/action',
  'POST /api/decisions/[id]/execute',
  'POST /api/decisions/[id]/observe',
  'POST /api/decisions/[id]/resume',
  'POST /api/decisions/[id]/rollback',
  'POST /api/memory',
  'POST /api/memory/[id]/review',
])
const API_DIR = fileURLToPath(new URL('../app/api/', import.meta.url))
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
interface RouteHandler { key: string; path: string; method: string; handler: Handler }

interface Contract {
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>
  components: {
    schemas: Record<string, unknown>
    responses: Record<string, { content?: Record<string, { schema?: unknown }> }>
  }
}

const contract = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../docs/api/openapi.json', import.meta.url)), 'utf8'),
) as Contract

/** The environment app-routes.test.ts already treats as the working baseline. */
const PRINCIPALS = JSON.stringify([
  { id: 'entity-owner', kind: 'human', tenantId: 'acme', roles: ['intent-provider', 'supervisor', 'developer', 'viewer'], tokenDigest: 'sha256:test-owner' },
])

function findRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return findRouteFiles(full)
    return name === 'route.ts' || name === 'route.tsx' ? [full] : []
  })
}

/**
 * Import every route module that loads under plain Node.
 *
 * Some route modules import `next/server`, which has no `exports` entry in
 * Next's package.json, so Node's ESM resolver cannot load it outside a bundler.
 * app-routes.test.ts does not hit this because its P-118 contract check reads
 * the route source as text rather than importing it.
 *
 * A module that cannot be imported is recorded, not silently dropped: it is
 * excluded here and still covered by the source-level contract test, and the
 * count is asserted below so the suite cannot pass by loading nothing.
 */
async function loadHandlers(): Promise<{ routes: RouteHandler[]; unimportable: string[] }> {
  const routes: RouteHandler[] = []
  const unimportable: string[] = []
  for (const file of findRouteFiles(API_DIR).sort()) {
    const rel = relative(API_DIR, file).split(sep).slice(0, -1).join('/')
    let mod: Record<string, unknown>
    try {
      mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>
    } catch {
      unimportable.push(`/api/${rel}`)
      continue
    }
    for (const method of HTTP_METHODS) {
      if (typeof mod[method] === 'function') {
        routes.push({ key: `${method} /api/${rel}`, path: `/api/${rel}`.replace(/\[([^\]]+)\]/g, 'test-$1'), method, handler: mod[method] as Handler })
      }
    }
  }
  return { routes, unimportable }
}

/** Resolve a local `$ref` pointer against the contract document. */
function resolvePointer(pointer: string): unknown {
  let node: unknown = contract
  for (const segment of pointer.replace(/^#\//, '').split('/')) {
    if (node === null || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return node
}

/**
 * The schema the contract declares for a successful response. The document uses
 * an OpenAPI 3.1 `2XX` wildcard for most operations and exact codes (200, 201,
 * 303) for the rest, so try the exact status first and fall back to the wildcard.
 */
function declaredSuccessSchema(status: number, operation: { responses: Record<string, unknown> } | undefined): { schema: unknown; via: string } | null {
  if (!operation) return null
  const candidates = [String(status), '2XX', '2xx']
  for (const code of candidates) {
    const entry = operation.responses[code]
    if (!entry) continue
    const ref = (entry as { $ref?: string }).$ref
    const response = (ref ? resolvePointer(ref) : entry) as { content?: Record<string, { schema?: unknown }> } | null
    const schema = response?.content?.['application/json']?.schema
    if (schema) return { schema, via: ref ? `${code} -> ${ref}` : code }
  }
  return null
}

/**
 * The contract's schemas are written as OpenAPI local pointers
 * (`#/components/schemas/Whoami`). Ajv resolves refs against a root schema, so
 * each component is registered under its bare name and the pointer prefix is
 * rewritten to match. Registering rather than inlining also lets ajv handle a
 * schema that refers back to itself.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true })
for (const [name, schema] of Object.entries(contract.components.schemas)) {
  ajv.addSchema({ ...(schema as object), $id: name }, name)
}

function compile(schema: unknown): ValidateFunction {
  return ajv.compile(rewriteRefs(schema) as object)
}

/** Rewrite `#/components/schemas/Name` and `#/components/responses/Name` to bare ids. */
function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs)
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      out[key] = value.replace(/^#\/components\/(schemas|responses)\//, '')
      continue
    }
    out[key] = rewriteRefs(value)
  }
  return out
}

test('P-118: a successful API response validates against its declared response schema', async () => {
  const previous = { ...process.env }
  process.env.QUICKSILVER_PRINCIPALS = PRINCIPALS
  process.env.QUICKSILVER_TENANT_ID = 'acme'
  delete process.env.QUICKSILVER_OIDC_ONLY

  const { routes, unimportable } = await loadHandlers()
  const validated: string[] = []
  const withoutSuccessSchema: string[] = []
  const notSuccessful: string[] = []
  const failures: string[] = []

  try {
    for (const route of routes) {
      const operation = contract.paths[route.path]?.[route.method.toLowerCase()]
      const declared = declaredSuccessSchema(200, operation)
      if (!declared) {
        withoutSuccessSchema.push(route.key)
        continue
      }

      const req = new Request(`http://localhost:3000${route.path}`, {
        method: route.method,
        headers: { 'content-type': 'application/json', authorization: 'Bearer test-owner' },
        ...(route.method === 'GET' ? {} : { body: '{}' }),
      })
      const res = await route.handler(req, { params: Promise.resolve({ id: 'test-id' }) })

      // Only successful responses are in scope; a refusal or an unconfigured
      // dependency is not evidence about the success schema.
      if (res.status < 200 || res.status >= 300) {
        notSuccessful.push(`${route.key} (${res.status})`)
        continue
      }

      const body = await res.json()
      const validate = compile(declared.schema)
      if (validate(body)) validated.push(route.key)
      else failures.push(`${route.key} [${declared.via}]: ${ajvMessage(validate)}`)
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }

  assert.deepEqual(failures, [], 'every successful response must match its declared response schema')

  // Without this the test could pass by skipping everything, for instance if a
  // harness change stopped handlers from ever succeeding.
  //
  // The floor is low because most routes reach Sanity or a model provider and
  // return 503/500 without credentials, which is a refusal, not evidence about
  // the success schema. What matters is that the routes which do serve a success
  // response really do match the contract, and that at least one runs at all.
  assert.ok(
    validated.length >= 1,
    `expected at least one real response to validate; validated=${validated.length} notSuccessful=${notSuccessful.length}`,
  )
  assert.deepEqual(
    [...withoutSuccessSchema].sort(),
    [...OPERATIONS_AWAITING_A_SUCCESS_SCHEMA].sort(),
    'an operation gained or lost its declared success response schema; add the schema to docs/api/openapi.json, or update the pinned debt list if the debt was settled',
  )

  if (process.env.QS_SCHEMA_REPORT) {
    console.error(`\nvalidated (${validated.length}):\n  ${validated.join('\n  ')}`)
    console.error(`\nnot successful (${notSuccessful.length}):\n  ${notSuccessful.slice(0, 12).join('\n  ')}`)
    console.error(`\nunimportable (${unimportable.length}):\n  ${unimportable.slice(0, 12).join('\n  ')}`)
  }
})

function ajvMessage(validate: ValidateFunction): string {
  return (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
}