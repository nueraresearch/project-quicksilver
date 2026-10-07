/**
 * Every error body from the publication, agent, workflow and decision routes carries a machine-readable
 * `code` next to the human `error` text, and a lost datastore revision race on a lifecycle write is a 409,
 * not a generic 500 (docs/api/api-contract.md, "Errors" and "409 conflicts").
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, relative, sep } from 'node:path'

import { digestToken } from '../../../packages/kernel/src/identity/tokens.ts'
import { setAuthorizationAuditAppender } from './authorization-audit-store.ts'

register('./route-test-loader.mjs', import.meta.url)
setAuthorizationAuditAppender(async () => 'test-authorization-audit-record')

const { apiErrorBody, errorCode } = await import('./api-errors.ts')
const { publicationFailure, readPublicationBody } = await import('./workflow-publication-http.ts')
const { WorkflowPublicationFault } = await import('./workflow-publication-store.ts')
const { AgentCatalogFault } = await import('./agent-catalog-contract.ts')

const API_DIR = fileURLToPath(new URL('../app/api/', import.meta.url))
const SCOPE = /^(agents|workflows|decisions|entities|plan|query|chat|inbox|monitoring|auth|dashboard)(\/|$)/

test('errorCode maps every status the API emits to one stable code', () => {
  assert.deepEqual(
    [400, 401, 403, 404, 409, 413, 422, 429, 500, 503].map(errorCode),
    ['invalid-request', 'unauthenticated', 'forbidden', 'not-found', 'conflict', 'payload-too-large', 'unprocessable', 'rate-limited', 'internal-error', 'unavailable'],
  )
  assert.equal(errorCode(418), 'invalid-request')
  assert.equal(errorCode(502), 'internal-error')
})

test('apiErrorBody pairs human-readable messages with stable status codes', () => {
  assert.deepEqual(apiErrorBody('Invalid request.', 400), { error: 'Invalid request.', code: 'invalid-request' })
  assert.deepEqual(apiErrorBody('Memory not found.', 404), { error: 'Memory not found.', code: 'not-found' })
  assert.deepEqual(apiErrorBody('Memory is unavailable.', 503), { error: 'Memory is unavailable.', code: 'unavailable' })
})

test('a lost Sanity revision race on a lifecycle write is a 409 with a code, not a generic 500', async () => {
  for (const lost of [
    Object.assign(new Error('Document revision ID mismatch'), { statusCode: 409 }),
    Object.assign(new Error('transaction failed'), { statusCode: 409 }),
    new Error('ifRevisionID does not match the current revision'),
  ]) {
    const response = publicationFailure(lost, 'Could not publish the workflow.')
    assert.equal(response.status, 409, lost.message)
    const body = await response.json() as { error: string; code: string }
    assert.equal(body.code, 'conflict')
    assert.match(body.error, /changed concurrently; refresh and retry/)
  }
})

test('other failures keep their status and gain a code', async () => {
  const generic = publicationFailure(new Error('connect ECONNRESET db.internal'), 'Could not publish the workflow.')
  assert.equal(generic.status, 500)
  assert.deepEqual(await generic.json(), { error: 'Could not publish the workflow.', code: 'internal-error' })

  const notFound = publicationFailure(new WorkflowPublicationFault('Workflow w@1 was not found.', 404), 'x')
  assert.equal(notFound.status, 404)
  assert.deepEqual(await notFound.json(), { error: 'Workflow w@1 was not found.', code: 'not-found' })

  const agentConflict = publicationFailure(new AgentCatalogFault('Built-in agents cannot be replaced.', 409), 'x')
  assert.equal(agentConflict.status, 409)
  assert.deepEqual(await agentConflict.json(), { error: 'Built-in agents cannot be replaced.', code: 'conflict' })

  const invalid = publicationFailure(new AgentCatalogFault('Display name must be 2-100 characters.', 400), 'x')
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json() as { code: string }).code, 'invalid-request')
})

test('the shared body reader marks oversized and malformed bodies with a code', async () => {
  const big = await readPublicationBody(new Request('http://localhost/x', { method: 'POST', body: 'x'.repeat(256 * 1024 + 1) }))
  assert.equal(big.ok, false)
  if (!big.ok) {
    assert.equal(big.response.status, 413)
    assert.equal((await big.response.json() as { code: string }).code, 'payload-too-large')
  }
  const bad = await readPublicationBody(new Request('http://localhost/x', { method: 'POST', body: '{nope' }))
  assert.equal(bad.ok, false)
  if (!bad.ok) {
    assert.equal(bad.response.status, 400)
    assert.equal((await bad.response.json() as { code: string }).code, 'invalid-request')
  }
})

const token = (name: string) => `${name}-${'e'.repeat(40)}`
const TOKENS = { nobody: token('nobody'), supervisor: token('supervisor') }
const PRINCIPALS = JSON.stringify([
  { id: 'entity-nobody', kind: 'human', tenantId: 'acme', roles: [], tokenDigest: digestToken(TOKENS.nobody) },
  { id: 'entity-ana', kind: 'human', tenantId: 'acme', roles: ['supervisor', 'developer'], tokenDigest: digestToken(TOKENS.supervisor) },
])
const CLEARED = ['NQC_SUPERVISOR_TOKEN', 'NQC_SUPERVISOR_ID', 'QUICKSILVER_SOLE_OPERATOR_ID', 'NEXT_PUBLIC_SANITY_PROJECT_ID', 'SANITY_AUTH_TOKEN', 'SANITY_READ_TOKEN', 'SANITY_WRITE_TOKEN', 'QUICKSILVER_WORKFLOW_LIVE_RUNS', 'QUICKSILVER_PROCESS_ENGINE']

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? routeFiles(full) : name === 'route.ts' ? [full] : []
  })
}

test('every error response from the agent, workflow, decision and entity routes has a string code', async () => {
  for (const name of CLEARED) delete process.env[name]
  process.env.QUICKSILVER_PRINCIPALS = PRINCIPALS
  process.env.QUICKSILVER_TENANT_ID = 'acme'
  let checked = 0
  const missing: string[] = []
  for (const file of routeFiles(API_DIR).sort()) {
    const rel = relative(API_DIR, file).split(sep).slice(0, -1).join('/')
    if (!SCOPE.test(rel)) continue
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>
    for (const method of ['GET', 'POST'] as const) {
      if (typeof mod[method] !== 'function') continue
      const handler = mod[method] as Handler
      const path = `/api/${rel}`.replace(/\[([^\]]+)\]/g, 'test-$1')
      for (const [label, authorization, body] of [
        ['no credential', undefined, '{}'],
        ['no permission', `Bearer ${TOKENS.nobody}`, '{}'],
        ['empty body', `Bearer ${TOKENS.supervisor}`, '{}'],
        ['malformed body', `Bearer ${TOKENS.supervisor}`, '{not json'],
        ['unknown field', `Bearer ${TOKENS.supervisor}`, JSON.stringify({ workflowId: 'w', version: 1, agentId: 'nuera-quicksilver:x', approvedBy: 'me', graph: {} })],
      ] as const) {
        const response = await handler(new Request(`http://localhost:3000${path}`, {
          method,
          headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
          ...(method === 'GET' ? {} : { body }),
        }), { params: Promise.resolve({ id: 'test-id' }) })
        if (response.status < 400) continue
        const json = await response.clone().json().catch(() => null) as { code?: unknown } | null
        checked++
        if (!json || typeof json.code !== 'string' || !json.code) missing.push(`${method} ${path} (${label}) -> ${response.status} ${JSON.stringify(json)}`)
      }
    }
  }
  assert.ok(checked > 40, `checked ${checked} error responses`)
  assert.deepEqual(missing, [])
})
