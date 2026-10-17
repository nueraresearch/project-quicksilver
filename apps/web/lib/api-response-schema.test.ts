import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { register } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import { workflowDigest, type WorkflowGraph } from '@quicksilver/kernel'
import { setSanitySeedDocuments } from './sanity-client.ts'
import { digestToken } from '../../../packages/kernel/src/identity/tokens.ts'

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
//
// Every operation must declare its success response, so the assertion below is
// an empty list rather than a pinned one. It used to pin 14 operations awaiting a
// schema, but all 14 already declared one: the gap was in this detector, which
// resolved the contract by the substituted request path (/api/decisions/test-id
// for the contract's /api/decisions/{id}) and matched only a hardcoded 200, so
// every dynamic route and every 201 read as undeclared. Three auth routes
// declare a bodyless 303 redirect, which is a success with no body to validate.

const API_DIR = fileURLToPath(new URL('../app/api/', import.meta.url))
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
interface RouteHandler { key: string; path: string; contractPath: string; method: string; handler: Handler }

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

/**
 * The environment app-routes.test.ts already treats as the working baseline.
 *
 * The digest must be a real one. This fixture used to carry the literal
 * `sha256:test-owner`, which is not a digest of any token, so the identity
 * provider refused to build and every guarded route answered 503
 * "Principals are misconfigured" before reaching its own logic. That, not a
 * missing Sanity credential, is why this suite used to validate 4 of 46
 * handlers. app-routes.test.ts already had the right shape; reuse it.
 *
 * Roles are the union that the route guard checks against, so a route is not
 * refused for want of authority before its response shape is ever exercised.
 */
const OWNER_TOKEN = 'qs_test_owner_token_for_response_schema_checks_0123456789'
const PRINCIPALS = JSON.stringify([
  {
    id: 'entity-owner',
    kind: 'human',
    tenantId: 'acme',
    roles: ['intent-provider', 'supervisor', 'developer', 'viewer', 'auditor'],
    tokenDigest: digestToken(OWNER_TOKEN),
  },
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
        // Two path forms: the request needs a concrete segment, the contract is
        // keyed by the `{param}` template. Resolving the contract by the
        // substituted path silently missed every dynamic route.
        const template = `/api/${rel}`.replace(/\[([^\]]+)\]/g, '{$1}')
        routes.push({
          key: `${method} /api/${rel}`,
          path: `/api/${rel}`.replace(/\[([^\]]+)\]/g, 'test-$1'),
          contractPath: template,
          method,
          handler: mod[method] as Handler,
        })
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
 * Whether the contract declares a success response at all for an operation.
 *
 * Success is 2xx, or the 3xx redirect that the OIDC start, callback and logout
 * routes return instead of a body. An operation declaring neither is undeclared.
 */
function declaresSuccessResponse(operation: { responses: Record<string, unknown> } | undefined): boolean {
  if (!operation) return false
  return Object.keys(operation.responses).some((code) => /^(2|3)\d\d$/.test(code) || /^2[Xx][Xx]$/.test(code) || /^3[Xx][Xx]$/.test(code))
}

/**
 * The schema the contract declares for a successful response. The document uses
 * an OpenAPI 3.1 `2XX` wildcard for most operations and exact codes (200, 201,
 * 303) for the rest, so try the exact status first and fall back to the wildcard.
 *
 * A 3xx that carries no JSON content is a declared success with nothing to
 * validate, so it resolves to null-but-declared rather than "undeclared".
 */
function declaredSuccessSchema(status: number, operation: { responses: Record<string, unknown> } | undefined): { schema: unknown; via: string } | 'no-body' | null {
  if (!operation) return null
  const candidates = [String(status), '2XX', '2xx']
  for (const code of candidates) {
    const entry = operation.responses[code]
    if (!entry) continue
    const ref = (entry as { $ref?: string }).$ref
    const response = (ref ? resolvePointer(ref) : entry) as { content?: Record<string, { schema?: unknown }> } | null
    const schema = response?.content?.['application/json']?.schema
    if (schema) return { schema, via: ref ? `${code} -> ${ref}` : code }
    // Declared, but a redirect or empty body: there is no JSON to check.
    return 'no-body'
  }
  // A redirect-only success (the OIDC start/callback and logout routes) has no
  // 2XX at all. It is still a declared success response.
  const redirect = Object.keys(operation.responses).find((code) => /^3\d\d$/.test(code))
  return redirect ? 'no-body' : null
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
  // Rewritten here too, not only on the operation schema below. A component
  // registered raw keeps its own `#/components/schemas/X` pointers, which ajv
  // then resolves against that component's `$id` and cannot find. This stayed
  // hidden while only four operations compiled; it surfaced as soon as the
  // route guard stopped refusing everything.
  ajv.addSchema({ ...(rewriteRefs(schema) as object), $id: name }, name)
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

/**
 * Per-route request inputs, keyed by `METHOD /api/path`.
 *
 * The contract declares the parameters and request bodies these routes accept,
 * so the harness supplies them rather than sending a bare `{}`. A route that
 * answers 400 proves its validation works and nothing about its declared
 * *response* schema, so a 400 here is dead coverage, not partial coverage.
 *
 * Values are the smallest thing that satisfies the route's own schema, so a
 * failure here still means "the response drifted", not "the request was wrong".
 */
type JsonSchema = Record<string, unknown>

/** Follow a `$ref` chain to the object it points at. */
function resolveSchema(node: unknown): JsonSchema {
  let current = node
  for (let hop = 0; hop < 8; hop += 1) {
    if (current === null || typeof current !== 'object' || typeof (current as { $ref?: unknown }).$ref !== 'string') break
    const next = resolvePointer((current as { $ref: string }).$ref)
    if (next === null || typeof next !== 'object') break
    current = next
  }
  return (current ?? {}) as JsonSchema
}

/**
 * Values for patterns the contract pins but a generic string will not satisfy.
 * Keyed by the pattern itself, so a route that tightens its schema shows up as
 * a failure rather than silently getting a wrong-shaped id.
 */
const PATTERN_VALUES: Record<string, string> = {
  '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$': 'daily-brief',
  '^nuera-quicksilver:[a-z][a-z0-9-]{0,62}$': 'nuera-quicksilver:query',
  '^sha256:[a-f0-9]{64}$': `sha256:${'a'.repeat(64)}`,
}

/**
 * The smallest value satisfying a JSON Schema, used to build a valid request
 * body from the contract the routes are documented against.
 *
 * The contract is the source of truth for what a request looks like, so
 * generating from it is better than a hand-written table that can drift. If a
 * generated body is rejected, that is the contract and the route disagreeing —
 * which is itself the kind of finding this suite exists to surface.
 */
function minimalValue(raw: unknown, depth = 0): unknown {
  const schema = resolveSchema(raw)
  if (depth > 6) return null

  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if ('const' in schema) return schema.const
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return minimalValue(schema.oneOf[0], depth + 1)
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) return minimalValue(schema.anyOf[0], depth + 1)

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  if (type === 'object' || (schema.properties && !type)) {
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
    const result: Record<string, unknown> = {}
    for (const name of required) {
      if (properties[name]) result[name] = minimalValue(properties[name], depth + 1)
    }
    return result
  }
  if (type === 'array') {
    // `[]` satisfies JSON Schema but not a route that also validates the value
    // (an agent manifest needs at least one task). Honour minItems.
    const items = (schema.items ?? {}) as JsonSchema
    return typeof schema.minItems === 'number' && schema.minItems >= 1 ? [minimalValue(items, depth + 1)] : []
  }
  if (type === 'integer' || type === 'number') return schema.minimum ?? 1
  if (type === 'boolean') return true
  if (type === 'string' || !type) {
    if (schema.format === 'date-time') return '2026-01-01T00:00:00.000Z'
    if (typeof schema.pattern === 'string' && schema.pattern in PATTERN_VALUES) return PATTERN_VALUES[schema.pattern]
    if (typeof schema.minLength === 'number') return 'a'.repeat(Math.max(1, schema.minLength))
    if (typeof schema.maxLength === 'number') return 'a'.repeat(Math.min(schema.maxLength, 12))
    return 'test-value'
  }
  return null
}

/** The request body the contract declares for an operation, as a minimal instance. */
function declaredRequestBody(contractPath: string, method: string): unknown {
  const operation = contract.paths[contractPath]?.[method.toLowerCase()] as { requestBody?: unknown } | undefined
  if (!operation?.requestBody) return {}
  const resolved = resolveSchema(operation.requestBody) as { content?: Record<string, { schema?: unknown }> }
  const schema = resolved.content?.['application/json']?.schema
  return schema ? minimalValue(schema) : {}
}

/**
 * A workflow graph the kernel actually accepts. This one cannot be generated:
 * `validateWorkflowGraph` is a domain rule (acyclic unless an isolated bounded
 * loop, data-only conditions, evaluation for agents, approval for side-effect
 * tools) that no JSON Schema expresses. Copied from the shape the host suite
 * uses, so it is known-valid rather than merely well-shaped.
 */
const VALID_WORKFLOW_GRAPH: WorkflowGraph = {
  schemaVersion: 1,
  id: 'daily-brief',
  version: 1,
  entryNodeId: 'start',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start' },
    { id: 'ask', kind: 'agent', label: 'Ask', config: { agentId: 'query', evaluationRequired: true, impact: 'low' } },
    { id: 'done', kind: 'output', label: 'Done' },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'ask' },
    { id: 'e2', from: 'ask', to: 'done' },
  ],
}

/**
 * A published workflow, so the publication routes have something to act on.
 *
 * The digest is computed by the kernel's own `workflowDigest`, never
 * hand-written: `workflow-publication-store` re-derives it on every read and
 * raises a 409 integrity fault on mismatch, so a plausible-looking fixture
 * would prove nothing. Same reasoning as the valid graph above.
 */
/**
 * The exact object `workflow-publication-store` rebuilds from a stored document
 * before it digests it. The digest covers `version`, so each seeded version
 * needs its own — sharing one across versions is what makes the whole
 * publication list fail with a 409 integrity fault.
 */
function seededGraph(version: number): WorkflowGraph {
  return {
    schemaVersion: 1 as const,
    id: 'daily-brief',
    version,
    entryNodeId: VALID_WORKFLOW_GRAPH.entryNodeId,
    nodes: VALID_WORKFLOW_GRAPH.nodes,
    edges: VALID_WORKFLOW_GRAPH.edges,
  }
}

const SEEDED_WORKFLOW = {
  _type: 'automationWorkflow',
  _id: 'workflows.automationWorkflow.daily-brief-v1',
  _rev: 'seed-revision-1',
  tenantId: 'acme',
  name: 'Daily brief',
  graphId: 'daily-brief',
  schemaVersion: 1,
  version: 1,
  lifecycle: 'active',
  entryNodeId: VALID_WORKFLOW_GRAPH.entryNodeId,
  nodes: VALID_WORKFLOW_GRAPH.nodes,
  edges: VALID_WORKFLOW_GRAPH.edges,
  graphDigest: '',
  authoredBy: 'entity-owner',
  createdAt: '2026-01-01T00:00:00.000Z',
  reviewedBy: 'entity-owner',
  reviewedAt: '2026-01-02T00:00:00.000Z',
  publishedAt: '2026-01-03T00:00:00.000Z',
}

/** A second draft, so version listing and diff have two points to compare. */
const SEEDED_WORKFLOW_DRAFT = {
  ...SEEDED_WORKFLOW,
  _id: 'workflows.automationWorkflow.daily-brief-v2',
  _rev: 'seed-revision-2',
  version: 2,
  lifecycle: 'draft',
  reviewedBy: undefined,
  reviewedAt: undefined,
  publishedAt: undefined,
}

setSanitySeedDocuments([
  { ...SEEDED_WORKFLOW, graphDigest: workflowDigest(seededGraph(1)) },
  { ...SEEDED_WORKFLOW_DRAFT, graphDigest: workflowDigest(seededGraph(2)) },
  { _type: 'workflowPublicationHead', _id: 'heads.daily-brief', _rev: 'seed-revision-h', tenantId: 'acme', graphId: 'daily-brief', activeVersion: 1 },
])

const REQUEST_FIXTURES: Record<string, { query?: Record<string, string>; body?: unknown; params?: Record<string, string> }> = {
  // workflowId: 1-128 chars, /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
  'GET /api/workflows/diff': { query: { workflowId: 'daily-brief', from: '1', to: '2' } },
  'GET /api/workflows/executions': { query: { workflowId: 'daily-brief', limit: '25' } },
  'GET /api/workflows/publications': { query: { workflowId: 'daily-brief' } },
  // agentId: /^nuera-quicksilver:[a-z][a-z0-9-]{0,62}$/
  'GET /api/agents/definitions': { query: { agentId: 'nuera-quicksilver:query' } },
  'POST /api/workflows/drafts': { body: { graph: VALID_WORKFLOW_GRAPH } },
  // The path id is validated by the route itself: /^mem-[a-f0-9]{10}$/.
  'POST /api/memory/[id]/review': { params: { id: 'mem-a1b2c3d4e5' }, body: { approve: true } },
  // The route superRefines this body beyond the contract: an approval carries
  // the exact fingerprint the reviewer saw. Not in the JSON Schema, so it is
  // spelled out here.
  'POST /api/decisions/[id]/action': {
    body: {
      action: 'approve',
      comment: 'Approved by the contract coverage suite.',
      expectedActionFingerprint: `sha256:${'a'.repeat(64)}`,
    },
  },
}

test('P-118: a successful API response validates against its declared response schema', async () => {
  const previous = { ...process.env }
  process.env.QUICKSILVER_PRINCIPALS = PRINCIPALS
  process.env.QUICKSILVER_TENANT_ID = 'acme'
  delete process.env.QUICKSILVER_OIDC_ONLY
  process.env.QS_SANITY_MOCK = '1'

  const { routes, unimportable } = await loadHandlers()
  const validated: string[] = []
  const withoutSuccessSchema: string[] = []
  const notSuccessful: string[] = []
  const failures: string[] = []

  try {
    for (const route of routes) {
      const operation = contract.paths[route.contractPath]?.[route.method.toLowerCase()]
      if (!declaresSuccessResponse(operation)) {
        withoutSuccessSchema.push(route.key)
        continue
      }

      const fixture = REQUEST_FIXTURES[route.key] ?? {}
      const url = new URL(`http://localhost:3000${route.path}`)
      for (const [name, value] of Object.entries(fixture.query ?? {})) url.searchParams.set(name, value)

      const req = new Request(url, {
        method: route.method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${OWNER_TOKEN}` },
        ...(route.method === 'GET' ? {} : { body: JSON.stringify(fixture.body ?? declaredRequestBody(route.contractPath, route.method)) }),
      })
      const res = await route.handler(req, { params: Promise.resolve({ id: 'test-id', ...(fixture.params ?? {}) }) })

      // Only successful responses are in scope; a refusal or an unconfigured
      // dependency is not evidence about the success schema. A 3xx redirect is
      // the success response for the OIDC and logout routes.
      if (res.status < 200 || res.status >= 400) {
        notSuccessful.push(`${route.key} (${res.status})`)
        continue
      }

      // Resolve against the status actually returned, not an assumed 200: the
      // contract declares 201 for the create routes and 303 for the redirects.
      const declared = declaredSuccessSchema(res.status, operation)
      if (declared === 'no-body') {
        const body = await res.text()
        if (body.length > 0) failures.push(`${route.key}: declared a redirect with no content but returned a body`)
        else validated.push(route.key)
        continue
      }
      if (!declared) {
        failures.push(`${route.key}: returned ${res.status}, which the contract does not declare`)
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
  // The floor is a real count, not a token one. This fixture used to carry a
  // placeholder `tokenDigest` and a 10-character bearer, both of which made the
  // identity provider refuse, so 42 of 46 routes answered 503 and only the four
  // unauthenticated auth routes ever ran. The credential problem was never the
  // blocker: with a real digest, a token of at least MIN_TOKEN_LENGTH, and the
  // Sanity mock answering each query shape the way an empty dataset would, 23
  // operations now validate against their declared schema.
  //
  // No route may fail request validation any more either. The harness builds
  // every body from the contract's own declared requestBody, adds query and path
  // parameters the contract requires, and falls back to a known-valid workflow
  // graph where JSON Schema cannot express a domain rule. A 400 here means the
  // request was wrong, which says nothing about the response schema.
  //
  // Raising this number is the point. Lowering it back toward 1 would restore
  // the illusion of coverage.
  assert.ok(
    validated.length >= 23,
    `expected at least 23 real responses to validate; validated=${validated.length} notSuccessful=${notSuccessful.length}\n  not yet covered:\n    ${notSuccessful.join('\n    ')}`,
  )
  // A 400/422 means the harness sent something the route rejected, so the route
  // never produced a response to check. That is dead coverage, and it is
  // silently re-introducible whenever a route tightens its schema.
  assert.deepEqual(
    notSuccessful.filter((entry) => / \((400|422)\)$/.test(entry)),
    [],
    'every operation must accept the request the contract declares; a request-validation refusal is not evidence about the response schema',
  )
  assert.deepEqual(
    withoutSuccessSchema,
    [],
    'every operation must declare a success response in docs/api/openapi.json; a bodyless 3xx redirect counts, anything else must declare a schema',
  )

  if (process.env.QS_SCHEMA_REPORT) {
    console.error(`\nvalidated (${validated.length}):\n  ${validated.join('\n  ')}`)
    // Print every refusal, not a sample. Truncating to twelve hid the shape of
    // the gap, which is most of what tells you whether it is closable.
    console.error(`\nnot successful (${notSuccessful.length}):\n  ${notSuccessful.join('\n  ')}`)
    console.error(`\nunimportable (${unimportable.length}):\n  ${unimportable.join('\n  ')}`)
  }
})

function ajvMessage(validate: ValidateFunction): string {
  return (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
}