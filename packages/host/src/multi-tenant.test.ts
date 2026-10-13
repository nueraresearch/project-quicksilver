/**
 * P-107: two tenants served by two host processes over the same storage. Run with `npm run host:test`.
 *
 * Every id that could collide does (run id, site id, principal id, review text), and the
 * file stores share one directory, so a missing tenant partition shows up as a leak here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateToken, type TokenPrincipalConfig } from '@quicksilver/kernel/identity/tokens'
import type { GenesisRunConfig } from '@quicksilver/kernel/playbooks/genesis'

import { parseHostConfig } from './config.ts'
import { FileGenesisStore } from './genesis-api.ts'
import { FileHostingStore, MemoryHostingAdapter } from './hosting.ts'
import { QuicksilverHost } from './host.ts'
import { Logger } from './log.ts'
import { FakeMediaProvider, FileMediaStore, MediaService, MEDIA_KINDS } from './media.ts'

const T0 = Date.parse('2026-10-03T12:00:00Z')
const PAGE = '<!doctype html><html><head><title>Report</title></head><body><h1>Report</h1></body></html>'

const runConfig = (): GenesisRunConfig => ({
  schemaVersion: 1,
  runId: 'genesis-test',
  playbookId: 'genesis',
  budgetUsd: 500,
  durationDays: 30,
  digitalOnly: true,
  allowedCategories: ['compute', 'hosting', 'advertising'],
  prohibitedCategories: ['inventory'],
  spend: { autoMaxUsd: 10, autoMaxRisk: 2, dailyCapUsd: 50 },
  waesRequired: true,
  waesManualReviewAllowed: true,
  prerequisites: { entityApproved: true, paymentAccounts: ['genesis-card'] },
  owner: 'entity-founder',
})

async function startTenant(tenantId: string, dir: string, adapter: MemoryHostingAdapter) {
  const { token, tokenDigest } = generateToken()
  const founder: TokenPrincipalConfig = { id: 'entity-founder', kind: 'human', tenantId, roles: ['intent-provider'], tokenDigest }
  const agentTok = generateToken()
  const agent: TokenPrincipalConfig = { id: 'agent-genesis', kind: 'agent', tenantId, roles: ['agent-worker'], tokenDigest: agentTok.tokenDigest }
  const auditDir = await mkdtemp(join(tmpdir(), 'qs-tenant-audit-'))
  const media = new MediaService({
    store: new FileMediaStore(dir, tenantId),
    policy: { budgetUsd: 1, autoMaxUsd: 0.1, maxRequestUsd: 0.5, defaultRetentionDays: 30, maxRetentionDays: 365, allowedKinds: MEDIA_KINDS, blockedTerms: [] },
    providers: [new FakeMediaProvider()],
    now: () => new Date(T0),
  })
  const host = new QuicksilverHost(parseHostConfig({ tenantId, http: { host: '127.0.0.1', port: 0 }, workflows: {} }), {
    principals: [founder, agent],
    env: { QUICKSILVER_AUTHORIZATION_AUDIT_PATH: join(auditDir, 'authorization.jsonl') },
    logger: new Logger({ level: 'error', sink: { write: () => {} } }),
    now: () => T0,
    genesis: { config: runConfig(), store: new FileGenesisStore(dir, tenantId), vaultNames: async () => ['genesis-card'] },
    hosting: { store: new FileHostingStore(dir, tenantId), adapter },
    media,
  })
  const { port } = await host.start()
  const call = (path: string, bearer: string, body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${bearer}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() as any }))
  const stop = async () => { await host.stop(); await rm(auditDir, { recursive: true, force: true }) }
  return { call, stop, tokens: { founder: token, agent: agentTok.token } }
}

test('two tenants on shared storage: hosting, media and Genesis never cross, and a token works only on its own tenant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qs-tenants-'))
  const adapter = new MemoryHostingAdapter()
  const a = await startTenant('alpha', dir, adapter)
  const b = await startTenant('beta', dir, adapter)
  try {
    // Alpha does real work under ids that beta will reuse.
    assert.equal((await a.call('/api/genesis/reviews', a.tokens.founder, { text: PAGE, channel: 'landing-page', verdict: 'pass', note: 'ok' })).status, 201)
    assert.equal((await a.call('/api/hosting/sites', a.tokens.agent, { id: 'launch', title: 'Alpha launch' })).status, 201)
    assert.equal((await a.call('/api/hosting/sites/launch/releases', a.tokens.agent, { files: [{ path: 'index.html', text: PAGE }] })).status, 201)
    assert.equal((await a.call('/api/hosting/sites/launch/releases/1/publish', a.tokens.founder, {})).status, 200)
    const made = await a.call('/api/media/requests', a.tokens.founder, { kind: 'speech', input: { text: 'Hello from alpha' } })
    assert.equal(made.status, 201)
    const assetId = made.body.asset.id as string

    // Beta sees none of it.
    assert.equal((await b.call('/api/hosting/sites', b.tokens.founder)).body.sites?.length ?? 0, 0, 'beta lists no sites')
    assert.equal((await b.call('/api/hosting/sites/launch', b.tokens.founder)).status, 404)
    assert.deepEqual((await b.call('/api/media/assets', b.tokens.founder)).body.assets, [])
    assert.equal((await b.call(`/api/media/assets/${assetId}`, b.tokens.founder)).status, 404)
    assert.equal((await b.call(`/api/media/assets/${assetId}/content`, b.tokens.founder)).status, 404)
    assert.equal((await b.call('/api/media', b.tokens.founder)).body.spentUsd, 0, 'beta has spent nothing')
    const betaRun = await b.call('/api/genesis', b.tokens.founder)
    assert.equal(betaRun.body.reviews.length, 0, 'beta has no reviews')
    assert.equal(betaRun.body.ledger.entries, 0)
    assert.equal((await b.call('/api/media/provenance', b.tokens.founder)).body.count, 0)

    // A page reviewed in alpha does not unlock the same page in beta.
    assert.equal((await b.call('/api/hosting/sites', b.tokens.agent, { id: 'launch', title: 'Beta launch' })).status, 201)
    assert.equal((await b.call('/api/hosting/sites/launch/releases', b.tokens.agent, { files: [{ path: 'index.html', text: PAGE }] })).status, 201)
    assert.equal((await b.call('/api/hosting/sites/launch/releases/1/publish', b.tokens.founder, {})).status, 409, "alpha's review of the same text does not count in beta")
    assert.deepEqual([...adapter.live.keys()], ['alpha/launch'], 'only alpha deployed, under its own tenant')

    // The same site id is two different sites.
    assert.equal((await a.call('/api/hosting/sites/launch', a.tokens.founder)).body.site.title, 'Alpha launch')
    assert.equal((await b.call('/api/hosting/sites/launch', b.tokens.founder)).body.site.title, 'Beta launch')

    // A token is good for its own tenant only, even for the same principal id.
    assert.equal((await b.call('/api/hosting/sites', a.tokens.founder)).status, 401)
    assert.equal((await a.call('/api/media', b.tokens.founder)).status, 401)
    assert.equal((await b.call(`/api/media/assets/${assetId}`, a.tokens.founder)).status, 401)

    // On disk each tenant has its own directory.
    assert.deepEqual((await readdir(dir)).sort(), ['alpha', 'beta'])
  } finally { await a.stop(); await b.stop(); await rm(dir, { recursive: true, force: true }) }
})

import { HOST_ROUTES } from './routes.ts'
import type { WorkflowGraph } from '@quicksilver/kernel/workflows/graph'
import { MemoryTaskClientPersistence, TaskClientRegistry } from './task-clients.ts'
import { MemoryTaskStore } from './tasks.ts'
import { generateMasterKey, SecretsVault } from './vault.ts'
import { AccessController } from '@quicksilver/kernel'
import { MemoryStore } from '@quicksilver/kernel'
import { MemoryShadowStore } from './shadow-api.ts'
import { MemoryActionStore } from './actions.ts'
import { dryRunTools } from './tool-executor.ts'
import { departmentAutonomy } from '@quicksilver/kernel/playbooks/operate'
import { generateWebhookSecret } from '@quicksilver/kernel/triggers'

test('a host refuses principals that belong to another tenant', () => {
  const { tokenDigest } = generateToken()
  assert.throws(() => new QuicksilverHost(parseHostConfig({ tenantId: 'alpha', http: { host: '127.0.0.1', port: 0 }, workflows: {} }), {
    principals: [{ id: 'entity-founder', kind: 'human', tenantId: 'beta', roles: ['viewer'], tokenDigest }],
    logger: new Logger({ level: 'error', sink: { write: () => {} } }),
  }), /belong to another tenant/)
})

test('scheduled routines and triggers in tenant A never trigger, execute, or leak into tenant B', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qs-tenants-sched-'))
  const sharedRunStore = join(dir, 'runs.json')
  const wfGraph: WorkflowGraph = {
    schemaVersion: 1, id: 'scheduled-wf', version: 1, entryNodeId: 'start',
    nodes: [{ id: 'start', kind: 'trigger', label: 'Start' }, { id: 'done', kind: 'output', label: 'Done' }],
    edges: [{ id: 'e1', from: 'start', to: 'done' }],
  }
  const tokenA = generateToken()
  const tokenB = generateToken()
  const founderA: TokenPrincipalConfig = { id: 'founder', kind: 'human', tenantId: 'alpha', roles: ['intent-provider', 'operator', 'viewer'], tokenDigest: tokenA.tokenDigest }
  const founderB: TokenPrincipalConfig = { id: 'founder', kind: 'human', tenantId: 'beta', roles: ['intent-provider', 'operator', 'viewer'], tokenDigest: tokenB.tokenDigest }

  let time = Date.parse('2026-10-05T07:59:00Z')
  const hostA = new QuicksilverHost(parseHostConfig({
    tenantId: 'alpha',
    http: { host: '127.0.0.1', port: 0 },
    worker: { id: 'worker-alpha', concurrency: 1, pollIntervalMs: 50 },
    queue: { defaultMaxAttempts: 1 },
    store: { kind: 'file', path: sharedRunStore },
    workflows: { 'scheduled-wf': wfGraph },
    services: [{ id: 'svc:sched-alpha', roles: ['trigger'] }],
    schedules: [{ id: 'alpha-routine', workflow: 'scheduled-wf', cron: '0 8 * * *', principal: 'svc:sched-alpha', input: { source: 'alpha' } }],
  }), {
    principals: [founderA],
    logger: new Logger({ level: 'error', sink: { write: () => {} } }),
    now: () => time,
  })

  const hostB = new QuicksilverHost(parseHostConfig({
    tenantId: 'beta',
    http: { host: '127.0.0.1', port: 0 },
    worker: { id: 'worker-beta', concurrency: 1, pollIntervalMs: 50 },
    queue: { defaultMaxAttempts: 1 },
    store: { kind: 'file', path: sharedRunStore },
    workflows: { 'scheduled-wf': wfGraph },
    services: [{ id: 'svc:sched-beta', roles: ['trigger'] }],
    schedules: [{ id: 'beta-routine', workflow: 'scheduled-wf', cron: '0 9 * * *', principal: 'svc:sched-beta', input: { source: 'beta' } }],
  }), {
    principals: [founderB],
    logger: new Logger({ level: 'error', sink: { write: () => {} } }),
    now: () => time,
  })

  const { port: portA } = await hostA.start()
  const { port: portB } = await hostB.start()

  const call = (port: number, path: string, bearer: string, body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${bearer}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() as any }))

  try {
    // Both hosts list only their own schedules.
    const schedA = await call(portA, '/api/schedules', tokenA.token)
    const schedB = await call(portB, '/api/schedules', tokenB.token)
    assert.deepEqual(schedA.body.schedules.map((s: any) => s.id), ['alpha-routine'])
    assert.deepEqual(schedB.body.schedules.map((s: any) => s.id), ['beta-routine'])
    assert.equal(schedA.body.schedules[0].tenantId, 'alpha')
    assert.equal(schedB.body.schedules[0].tenantId, 'beta')

    // Advance time to 08:00 UTC and tick hostA's scheduler.
    time = Date.parse('2026-10-05T08:00:00Z')
    const tickResultsA = await hostA.scheduler.tick()
    assert.equal(tickResultsA.length, 1)
    assert.equal(tickResultsA[0]?.result.accepted, true)

    // Wait briefly for queue processing.
    await new Promise((r) => setTimeout(r, 100))

    // Host A has the run.
    const runsA = await call(portA, '/api/runs', tokenA.token)
    assert.equal(runsA.body.runs.length, 1)
    assert.equal(runsA.body.runs[0].trigger.source, 'alpha-routine')

    // Host B has no runs at all.
    const runsB = await call(portB, '/api/runs', tokenB.token)
    assert.equal(runsB.body.runs.length, 0)

    // Advance time to 09:00 UTC and tick hostB's scheduler.
    time = Date.parse('2026-10-05T09:00:00Z')
    const tickResultsB = await hostB.scheduler.tick()
    assert.equal(tickResultsB.length, 1)
    assert.equal(tickResultsB[0]?.result.accepted, true)

    await new Promise((r) => setTimeout(r, 100))

    // Host B sees only its beta-routine run, never alpha's run.
    const runsBAfter = await call(portB, '/api/runs', tokenB.token)
    assert.equal(runsBAfter.body.runs.length, 1)
    assert.equal(runsBAfter.body.runs[0].trigger.source, 'beta-routine')
    assert.equal((await call(portB, `/api/runs/${runsA.body.runs[0].runId}`, tokenB.token)).status, 404)
  } finally {
    await hostA.stop({ abort: true })
    await hostB.stop({ abort: true })
    await rm(dir, { recursive: true, force: true })
  }
})

test('cross-tenant requests with foreign tenant principals are strictly refused fail-closed across all host routes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qs-foreign-refuse-'))
  const auditDirA = await mkdtemp(join(tmpdir(), 'qs-foreign-audit-a-'))
  const auditDirB = await mkdtemp(join(tmpdir(), 'qs-foreign-audit-b-'))

  const tokenA = generateToken()
  const tokenB = generateToken()

  // Full set of permissions for tenant A and tenant B.
  const allRoles = ['supervisor', 'intent-provider', 'intent-admin', 'tenant-admin', 'developer', 'operator', 'auditor']
  const principalA: TokenPrincipalConfig = { id: 'admin-alpha', kind: 'human', tenantId: 'alpha', roles: allRoles, tokenDigest: tokenA.tokenDigest }
  const principalB: TokenPrincipalConfig = { id: 'admin-beta', kind: 'human', tenantId: 'beta', roles: allRoles, tokenDigest: tokenB.tokenDigest }

  const testGraph: WorkflowGraph = {
    schemaVersion: 1, id: 'test-wf', version: 1, entryNodeId: 'start',
    nodes: [{ id: 'start', kind: 'trigger', label: 'Start' }, { id: 'done', kind: 'output', label: 'Done' }],
    edges: [{ id: 'e1', from: 'start', to: 'done' }],
  }

  const clientsA = new TaskClientRegistry({ persistence: new MemoryTaskClientPersistence(), tenantId: 'alpha' })
  const webhookSecret = generateWebhookSecret()
  const masterKey = generateMasterKey()

  const hostA = new QuicksilverHost(parseHostConfig({
    tenantId: 'alpha',
    http: { host: '127.0.0.1', port: 0 },
    worker: { id: 'worker-alpha', concurrency: 1, pollIntervalMs: 50 },
    vault: { path: join(dir, 'vault-alpha.json') },
    workflows: { 'test-wf': testGraph },
    services: [{ id: 'svc:hook', roles: ['trigger'] }, { id: 'svc:sched', roles: ['trigger'] }],
    webhooks: [{ id: 'erp-orders', workflow: 'test-wf', secret: 'env:HOOK_SECRET', principal: 'svc:hook' }],
    schedules: [{ id: 'sched-alpha', workflow: 'test-wf', cron: '0 8 * * *', principal: 'svc:sched' }],
  }), {
    principals: [principalA],
    env: { QUICKSILVER_VAULT_KEY: masterKey, HOOK_SECRET: webhookSecret, QUICKSILVER_AUTHORIZATION_AUDIT_PATH: join(auditDirA, 'auth.jsonl') },
    logger: new Logger({ level: 'error', sink: { write: () => {} } }),
    shadow: { store: new MemoryShadowStore() } as any,
    genesis: { config: runConfig(), store: new FileGenesisStore(dir, 'alpha'), vaultNames: async () => [] },
    hosting: { store: new FileHostingStore(dir, 'alpha'), adapter: new MemoryHostingAdapter() },
    media: new MediaService({
      store: new FileMediaStore(dir, 'alpha'),
      policy: { budgetUsd: 1, autoMaxUsd: 0.1, maxRequestUsd: 0.5, defaultRetentionDays: 30, maxRetentionDays: 365, allowedKinds: MEDIA_KINDS, blockedTerms: [] },
      providers: [new FakeMediaProvider()],
      now: () => new Date(T0),
    }),
    actions: { store: new MemoryActionStore('alpha'), tools: dryRunTools(), policy: { enabledTools: [] } },
    memory: { store: new MemoryStore(), decisionExists: async () => true },
    intent: {} as any,
    decisions: {} as any,
    tasks: {
      store: new MemoryTaskStore(),
      clients: clientsA,
      catalog: { defaultCapabilityId: 'task.triage', capabilities: [{ id: 'task.triage', name: 'Triage', description: 'Triage', department: 'operations', baseRiskLevel: 4 }] },
      autonomy: async (dept: string) => departmentAutonomy(undefined, undefined, dept),
    },
  })

  // Pre-seed a secret in hostA's vault so /api/secrets endpoints are populated.
  const vaultAlpha = new SecretsVault({ path: join(dir, 'vault-alpha.json'), masterKey, tenantId: 'alpha', access: new AccessController() })
  await vaultAlpha.open()
  await vaultAlpha.put({ id: 'admin-alpha', kind: 'human', tenantId: 'alpha', roles: ['tenant-admin'] }, 'seed-secret', 'secret-val')

  const { port } = await hostA.start()

  const concrete = (path: string) => path.replace(/:([a-zA-Z]+)/g, 'test-$1')

  try {
    // For every route in HOST_ROUTES, verify that tokenB (belonging to tenant 'beta')
    // is strictly refused fail-closed (401 Unauthorized for authenticated routes, or 401 for unsigned webhooks).
    for (const route of HOST_ROUTES) {
      const path = route.path.startsWith('/webhooks/') ? '/webhooks/erp-orders' : concrete(route.path)
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: route.method,
        headers: {
          authorization: `Bearer ${tokenB.token}`,
          ...(route.method !== 'GET' ? { 'content-type': 'application/json' } : {}),
        },
        ...(route.method !== 'GET' ? { body: JSON.stringify({}) } : {}),
      })

      if (route.access.kind === 'public') {
        if (route.path.startsWith('/webhooks/')) {
          assert.equal(res.status, 401, `${route.method} ${route.path} unsigned webhook must refuse foreign bearer token with 401`)
        } else {
          // Public routes remain public probes (/healthz, /readyz, /, /console).
          assert.ok(res.status === 200 || res.status === 503, `${route.method} ${route.path} public probe`)
        }
      } else {
        // ANY non-public route (principal or permission) MUST return 401 Unauthenticated
        // because the principal from tenant beta does not belong to host alpha.
        assert.equal(res.status, 401, `${route.method} ${route.path} must refuse foreign tenant token with 401`)
      }
    }
  } finally {
    await hostA.stop({ abort: true })
    await rm(dir, { recursive: true, force: true })
    await rm(auditDirA, { recursive: true, force: true })
    await rm(auditDirB, { recursive: true, force: true })
  }
})
