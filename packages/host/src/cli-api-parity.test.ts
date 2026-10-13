/**
 * P-117: the Genesis money CLI (spend, compute, revenue, refund) and POST /api/genesis/money must apply the same rules.
 * Each case is run through the real CLI process and through a real host over separate data directories, then the
 * outcomes (recorded, needs confirmation, refused) and the ledger entries are compared.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { AccessController } from '@quicksilver/kernel/identity'
import { generateToken, type TokenPrincipalConfig } from '@quicksilver/kernel/identity/tokens'
import type { GenesisRunConfig } from '@quicksilver/kernel/playbooks/genesis'

import { parseHostConfig } from './config.ts'
import { FileGenesisStore } from './genesis-api.ts'
import { QuicksilverHost } from './host.ts'
import { Logger } from './log.ts'
import { generateMasterKey, SecretsVault } from './vault.ts'

const exec = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const cli = join(here, 'genesis-cli.ts')

type Outcome = 'recorded' | 'needs-confirmation' | 'refused'
interface Case {
  name: string
  kind: 'spend' | 'compute' | 'revenue' | 'refund'
  amountUsd: number | string
  category?: string
  description: string
  source?: string
  experimentId?: string
  confirm?: boolean
}

const OK = 'provider-usage:run-1'
const CASES: Case[] = [
  { name: 'compute inside the auto limit', kind: 'compute', amountUsd: 5, description: 'Model calls for the landing page.', source: OK },
  { name: 'spend on an allowed category inside the auto limit', kind: 'spend', amountUsd: 5, category: 'hosting', description: 'One month of hosting.', source: 'invoice:inv-1' },
  { name: 'spend above the auto limit needs a decision', kind: 'spend', amountUsd: 25, category: 'advertising', description: 'Ad test.', source: 'receipt:r-1' },
  { name: 'the same spend with confirmation is recorded', kind: 'spend', amountUsd: 25, category: 'advertising', description: 'Ad test.', source: 'receipt:r-2', confirm: true },
  { name: 'spend on a prohibited category', kind: 'spend', amountUsd: 5, category: 'inventory', description: 'Stock.', source: 'receipt:r-3' },
  { name: 'spend over the whole budget', kind: 'spend', amountUsd: 600, category: 'hosting', description: 'Too much.', source: 'receipt:r-4', confirm: true },
  { name: 'zero amount', kind: 'compute', amountUsd: 0, description: 'Nothing.', source: OK },
  { name: 'negative amount', kind: 'compute', amountUsd: -5, description: 'Negative.', source: OK },
  { name: 'amount that is not a number', kind: 'compute', amountUsd: 'abc', description: 'Text.', source: OK },
  { name: 'revenue with an allowed source', kind: 'revenue', amountUsd: 20, description: 'First sale.', source: 'payment-processor:pi_1' },
  { name: 'revenue above one million dollars', kind: 'revenue', amountUsd: 2_000_000, description: 'Huge.', source: 'payment-processor:pi_2' },
  { name: 'a valid refund of earlier revenue', kind: 'refund', amountUsd: 5, category: 'sales', description: 'Refund of the first sale.', source: 'payment-processor:re_0' },
  { name: 'a refund with an uppercase, spaced category', kind: 'refund', amountUsd: 5, category: 'Sales Q3', description: 'Odd category.', source: 'payment-processor:re_3' },
  { name: 'a description of 600 characters', kind: 'compute', amountUsd: 5, description: 'x'.repeat(600), source: OK },
  { name: 'a description of only spaces', kind: 'compute', amountUsd: 5, description: '   ', source: OK },
  { name: 'an unknown source type', kind: 'compute', amountUsd: 5, description: 'Bad source.', source: 'telepathy:abc' },
  { name: 'a source with an empty reference', kind: 'compute', amountUsd: 5, description: 'Empty ref.', source: 'receipt:' },
  { name: 'a source reference of 300 characters', kind: 'compute', amountUsd: 5, description: 'Long ref.', source: `receipt:${'r'.repeat(300)}` },
  { name: 'an experiment that does not exist', kind: 'compute', amountUsd: 5, description: 'No such experiment.', source: OK, experimentId: 'exp-missing' },
  { name: 'an experiment id with illegal characters', kind: 'compute', amountUsd: 5, description: 'Bad id.', source: OK, experimentId: 'Bad Id!' },
  { name: 'a refund larger than any revenue', kind: 'refund', amountUsd: 50, category: 'sales', description: 'Refund.', source: 'payment-processor:re_1' },
]

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'qs-parity-'))
  const config = JSON.parse(await readFile(join(repo, 'deploy', 'genesis', 'genesis-500.json'), 'utf8')) as GenesisRunConfig
  const paymentAccounts = ['genesis-payments', 'genesis-card']
  const shared = { ...config, prerequisites: { entityApproved: true, paymentAccounts } }
  const configPath = join(dir, 'genesis.json')
  await writeFile(configPath, JSON.stringify(shared))
  const hostConfigPath = join(dir, 'host.json')
  const vaultPath = join(dir, 'vault.json')
  const vaultKeyEnv = 'QUICKSILVER_PARITY_VAULT_KEY'
  const vaultMasterKey = generateMasterKey()
  await writeFile(hostConfigPath, JSON.stringify({ tenantId: 'nuera', vault: { path: vaultPath, keyEnv: vaultKeyEnv } }))
  const cliVault = new SecretsVault({ path: vaultPath, masterKey: vaultMasterKey, tenantId: 'nuera', access: new AccessController() })
  await cliVault.open()
  const vaultAdmin = { id: 'genesis-parity-test', kind: 'human' as const, tenantId: 'nuera', roles: ['tenant-admin'] }
  for (const name of paymentAccounts) await cliVault.put(vaultAdmin, name, 'test-only-placeholder')
  const credentials = generateToken()
  const founder: TokenPrincipalConfig = { id: 'entity-founder', kind: 'human', tenantId: 'nuera', roles: ['intent-provider', 'viewer'], tokenDigest: credentials.tokenDigest }
  const cliData = join(dir, 'cli-data')
  const apiData = join(dir, 'api-data')
  const host = new QuicksilverHost(parseHostConfig({ tenantId: 'nuera', http: { host: '127.0.0.1', port: 0 }, workflows: {} }), {
    principals: [founder],
    logger: new Logger({ level: 'error', sink: { write: () => {} } }),
    genesis: { config: shared, store: new FileGenesisStore(apiData, 'nuera'), vaultNames: async () => ['genesis-payments', 'genesis-card'] },
  })
  const env = {
    ...process.env, [vaultKeyEnv]: vaultMasterKey, INIT_CWD: repo, QUICKSILVER_GENESIS_CONFIG: configPath, QUICKSILVER_GENESIS_DIR: cliData, QUICKSILVER_GENESIS_STORE: 'file',
    QUICKSILVER_GENESIS_ACTOR: 'entity-founder', QUICKSILVER_HOST_CONFIG: hostConfigPath, QUICKSILVER_TENANT_ID: 'nuera',
  }
  const { port } = await host.start()
  const runCliExperiment = (...args: string[]) => exec(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, ...args], { cwd: repo, env })
  const runCliDraft = async (definition: Record<string, unknown>) => {
    const definitionPath = join(dir, 'experiment-definition.json')
    await writeFile(definitionPath, JSON.stringify(definition))
    return runCliExperiment('experiment', 'draft', definitionPath)
  }
  const runApiDraft = (definition: Record<string, unknown>) => fetch(`http://127.0.0.1:${port}/api/genesis/experiments`, {
    method: 'POST', headers: { authorization: `Bearer ${credentials.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ definition }),
  })
  const runApiExperimentAction = (id: string, action: string, body: Record<string, unknown> = {}) => fetch(`http://127.0.0.1:${port}/api/genesis/experiments/${encodeURIComponent(id)}/${action}`, {
    method: 'POST', headers: { authorization: `Bearer ${credentials.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const runCli = async (c: Case): Promise<Outcome> => {
    const hasCategory = c.kind === 'spend' || c.kind === 'refund'
    const args = [c.kind, String(c.amountUsd), ...(hasCategory ? [c.category ?? ''] : []), c.description, ...(c.source !== undefined ? ['--source', c.source] : []), ...(c.experimentId ? ['--experiment', c.experimentId] : []), ...(c.confirm ? ['--confirm'] : [])]
    try { await exec(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, ...args], { cwd: repo, env }); return 'recorded' } catch (e) {
      return /needs your decision/.test((e as { stderr?: string }).stderr ?? '') ? 'needs-confirmation' : 'refused'
    }
  }
  const runApi = async (c: Case): Promise<Outcome> => {
    const sep = c.source?.indexOf(':') ?? -1
    const body = {
      kind: c.kind, amountUsd: c.amountUsd, description: c.description,
      ...(c.category !== undefined ? { category: c.category } : {}),
      ...(c.source !== undefined && sep > 0 ? { source: { type: c.source.slice(0, sep), ref: c.source.slice(sep + 1) } } : {}),
      ...(c.experimentId ? { experimentId: c.experimentId } : {}), ...(c.confirm ? { confirm: true } : {}),
    }
    const res = await fetch(`http://127.0.0.1:${port}/api/genesis/money`, { method: 'POST', headers: { authorization: `Bearer ${credentials.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return res.status === 201 ? 'recorded' : res.status === 409 ? 'needs-confirmation' : 'refused'
  }
  const ledger = async (root: string, tenant: string) => {
    try {
      const raw = JSON.parse(await readFile(join(root, tenant, config.runId as string, 'ledger.json'), 'utf8')) as { entries?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      const entries = Array.isArray(raw) ? raw : raw.entries ?? []
      return entries.map((e) => ({ kind: e.kind, amountUsd: e.amountUsd, category: e.category, description: e.description, source: e.source }))
    } catch { return [] }
  }
  return { runCli, runApi, runCliExperiment, runCliDraft, runApiDraft, runApiExperimentAction, ledger, cliData, apiData, runId: config.runId as string, stop: async () => { await host.stop({ abort: true }); await rm(dir, { recursive: true, force: true }) } }
}

test('Genesis money: the CLI and the HTTP API reach the same outcome for the same input', async () => {
  const h = await setup()
  const diffs: string[] = []
  try {
    for (const c of CASES) {
      const [viaCli, viaApi] = [await h.runCli(c), await h.runApi(c)]
      if (viaCli !== viaApi) diffs.push(`${c.name}: CLI ${viaCli}, API ${viaApi}`)
    }
    assert.deepEqual(diffs, [], `the CLI and the API disagree on:\n${diffs.join('\n')}`)
    // What was recorded is the same on both sides, entry for entry.
    const recorded = await h.ledger(h.apiData, 'nuera')
    assert.ok(recorded.length >= 4, `the comparison covers real entries (${recorded.length})`)
    assert.deepEqual(await h.ledger(h.cliData, 'nuera'), recorded)
  } finally { await h.stop() }
})

test('Genesis experiments: CLI and HTTP API share draft/start/measure/decide behavior and refuse a mismatched playbook', async () => {
  const h = await setup()
  const definition = {
    id: 'exp-cli-api-parity',
    hypothesis: 'The CLI and HTTP API apply the same experiment draft rules.',
    playbookId: 'genesis',
    metric: { id: 'parity-score', label: 'Parity score', direction: 'higher-is-better', kill: 0.1, hold: 0.5, scale: 1 },
    budgetUsd: 25,
    durationDays: 7,
    customerFacing: false,
    proposedBy: 'entity-founder',
  }
  try {
    await h.runCliDraft(definition)
    const apiResponse = await h.runApiDraft(definition)
    const apiBody = await apiResponse.json() as { experiment: unknown }
    assert.equal(apiResponse.status, 201)

    const cliExperiments = JSON.parse(await readFile(join(h.cliData, 'nuera', h.runId, 'experiments.json'), 'utf8')) as unknown[]
    assert.equal(cliExperiments.length, 1)
    assert.deepEqual(cliExperiments[0], apiBody.experiment, 'the same valid definition produces the same persisted draft')

    const id = definition.id
    await h.runCliExperiment('experiment', 'start', id)
    assert.equal((await h.runApiExperimentAction(id, 'start')).status, 200)
    await h.runCliExperiment('measure', id, '0.05', 'shared parity fixture')
    assert.equal((await h.runApiExperimentAction(id, 'measurements', { value: 0.05, source: 'shared parity fixture' })).status, 201)
    await h.runCliExperiment('decide', id, 'P-117 parity fixture')
    assert.equal((await h.runApiExperimentAction(id, 'decide', { note: 'P-117 parity fixture' })).status, 200)

    type ExperimentSnapshot = {
      startedAt?: string
      endsAt?: string
      measurements: Array<Record<string, unknown>>
      decisions: Array<Record<string, unknown>>
      [key: string]: unknown
    }
    const stripTimestamp = (record: Record<string, unknown>) => {
      const stable = { ...record }
      delete stable.at
      delete stable.startedAt
      delete stable.endsAt
      return stable
    }
    const readExperiments = async (root: string) => JSON.parse(await readFile(join(root, 'nuera', h.runId, 'experiments.json'), 'utf8')) as ExperimentSnapshot[]
    const normalize = (experiments: ExperimentSnapshot[]) => experiments.map((experiment) => ({
      ...stripTimestamp(experiment),
      measurements: experiment.measurements.map(stripTimestamp),
      decisions: experiment.decisions.map(stripTimestamp),
    }))
    assert.deepEqual(normalize(await readExperiments(h.cliData)), normalize(await readExperiments(h.apiData)), 'the CLI and API persist equivalent experiment lifecycle state')

    const invalid = { ...definition, id: 'exp-cli-api-invalid', playbookId: 'another-playbook' }
    await assert.rejects(h.runCliDraft(invalid), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /belongs to playbook/)
      return true
    })
    const refused = await h.runApiDraft(invalid)
    assert.equal(refused.status, 422, 'the HTTP API refuses the same playbook mismatch')
    assert.equal((await readExperiments(h.cliData)).length, 1, 'the refused CLI draft is not persisted')
  } finally { await h.stop() }
})

test('Genesis experiments: CLI and HTTP API validation error parity on draft, start, measure, and decide', async () => {
  const h = await setup()
  try {
    const readExperiments = async (root: string) => {
      try {
        return JSON.parse(await readFile(join(root, 'nuera', h.runId, 'experiments.json'), 'utf8')) as Array<Record<string, unknown>>
      } catch {
        return []
      }
    }

    // 1. Validation error parity on draft
    const baseDef = {
      id: 'exp-parity-val',
      hypothesis: 'Testing validation parity.',
      playbookId: 'genesis',
      metric: { id: 'score', label: 'Score', direction: 'higher-is-better', kill: 0.1, hold: 0.5, scale: 1 },
      budgetUsd: 50,
      durationDays: 7,
      customerFacing: false,
      proposedBy: 'entity-founder',
    }

    const invalidDraftCases: Array<{ name: string; def: Record<string, unknown>; expectedPattern: RegExp; expectedStatus: number }> = [
      {
        name: 'durationDays exceeds 90',
        def: { ...baseDef, durationDays: 100 },
        expectedPattern: /durationDays must be a whole number from 1 to 90/,
        expectedStatus: 422,
      },
      {
        name: 'budgetUsd is zero or negative',
        def: { ...baseDef, budgetUsd: -10 },
        expectedPattern: /budgetUsd must be more than zero/,
        expectedStatus: 422,
      },
      {
        name: 'metric thresholds out of order',
        def: { ...baseDef, metric: { id: 'score', label: 'Score', direction: 'higher-is-better', kill: 1.0, hold: 0.5, scale: 0.1 } },
        expectedPattern: /metric thresholds are out of order/,
        expectedStatus: 422,
      },
      {
        name: 'hypothesis empty or whitespace',
        def: { ...baseDef, hypothesis: '   ' },
        expectedPattern: /hypothesis must be 1 to 1,000 characters/,
        expectedStatus: 422,
      },
      {
        name: 'invalid experiment id characters',
        def: { ...baseDef, id: 'bad id with spaces!' },
        expectedPattern: /definition\.id must be letters|id is invalid/,
        expectedStatus: 422,
      },
    ]

    for (const c of invalidDraftCases) {
      await assert.rejects(h.runCliDraft(c.def), (error: Error & { stderr?: string }) => {
        const text = error.stderr ?? error.message
        assert.match(text, c.expectedPattern, `CLI draft validation mismatch for: ${c.name}`)
        return true
      })
      const apiRes = await h.runApiDraft(c.def)
      assert.equal(apiRes.status, c.expectedStatus, `API draft status mismatch for: ${c.name}`)
      const apiJson = await apiRes.json() as { error?: string; reasons?: string[] }
      const errText = [apiJson.error, ...(apiJson.reasons ?? [])].filter(Boolean).join(' ')
      assert.match(errText, c.expectedPattern, `API draft error text mismatch for: ${c.name}`)
    }

    // Persist a valid experiment to both sides
    await h.runCliDraft(baseDef)
    const apiDraftRes = await h.runApiDraft(baseDef)
    assert.equal(apiDraftRes.status, 201)

    // Duplicate draft error parity
    await assert.rejects(h.runCliDraft(baseDef), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /already exists/)
      return true
    })
    const dupApiRes = await h.runApiDraft(baseDef)
    assert.equal(dupApiRes.status, 409)
    const dupApiJson = await dupApiRes.json() as { error?: string }
    assert.match(dupApiJson.error ?? '', /already exists/)

    // 2. Validation error parity on start: non-existent experiment
    await assert.rejects(h.runCliExperiment('experiment', 'start', 'exp-missing'), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /No experiment "exp-missing"/)
      return true
    })
    const startMissingApiRes = await h.runApiExperimentAction('exp-missing', 'start')
    assert.equal(startMissingApiRes.status, 404)
    const startMissingApiJson = await startMissingApiRes.json() as { error?: string }
    assert.match(startMissingApiJson.error ?? '', /No experiment "exp-missing"/)

    // 3. Validation error parity on measure: not running/held yet (still in draft)
    await assert.rejects(h.runCliExperiment('measure', baseDef.id, '0.5', 'test-source'), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /Only a running or held experiment takes measurements/)
      return true
    })
    const measureDraftApiRes = await h.runApiExperimentAction(baseDef.id, 'measurements', { value: 0.5, source: 'test-source' })
    assert.equal(measureDraftApiRes.status, 409)
    const measureDraftApiJson = await measureDraftApiRes.json() as { error?: string; reasons?: string[] }
    assert.match([measureDraftApiJson.error, ...(measureDraftApiJson.reasons ?? [])].join(' '), /Only a running or held experiment takes measurements/)

    // 4. Validation error parity on decide: experiment does not exist
    await assert.rejects(h.runCliExperiment('decide', 'exp-missing', 'missing test'), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /No experiment "exp-missing"/)
      return true
    })
    const decideMissingApiRes = await h.runApiExperimentAction('exp-missing', 'decide', { note: 'missing test' })
    assert.equal(decideMissingApiRes.status, 404)
    const decideMissingJson = await decideMissingApiRes.json() as { error?: string }
    assert.match(decideMissingJson.error ?? '', /No experiment "exp-missing"/)

    // Now start the experiment on both sides
    await h.runCliExperiment('experiment', 'start', baseDef.id)
    const startApiRes = await h.runApiExperimentAction(baseDef.id, 'start')
    assert.equal(startApiRes.status, 200)

    // Cannot start an already running experiment
    await assert.rejects(h.runCliExperiment('experiment', 'start', baseDef.id), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /Only a draft experiment can start/)
      return true
    })
    const restartApiRes = await h.runApiExperimentAction(baseDef.id, 'start')
    assert.equal(restartApiRes.status, 409)
    const restartApiJson = await restartApiRes.json() as { error?: string; reasons?: string[] }
    assert.match([restartApiJson.error, ...(restartApiJson.reasons ?? [])].join(' '), /Only a draft experiment can start/)

    // Measurement validation errors: missing/empty source, invalid number
    await assert.rejects(h.runCliExperiment('measure', baseDef.id, 'not-a-number', 'test-source'), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /The value must be a number|value must be a finite number/)
      return true
    })
    const badValApiRes = await h.runApiExperimentAction(baseDef.id, 'measurements', { value: 'not-a-number', source: 'test-source' })
    assert.equal(badValApiRes.status, 422)

    await assert.rejects(h.runCliExperiment('measure', baseDef.id, '0.5', '   '), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /Every measurement names its source|source must be 1 to 300 characters/)
      return true
    })
    const badSrcApiRes = await h.runApiExperimentAction(baseDef.id, 'measurements', { value: 0.5, source: '   ' })
    assert.equal(badSrcApiRes.status, 422)

    // Decide with no measurement yet:
    // CLI prints no-data and does not apply any decision.
    // HTTP API returns 409 'Nothing to decide yet.'
    const decideNoDataApiRes = await h.runApiExperimentAction(baseDef.id, 'decide', { note: 'still no data' })
    assert.equal(decideNoDataApiRes.status, 409)
    const decideNoDataJson = await decideNoDataApiRes.json() as { error?: string }
    assert.match(decideNoDataJson.error ?? '', /Nothing to decide yet/)

    // Verify store experiments remained identical and clean
    const cliExps = await readExperiments(h.cliData)
    const apiExps = await readExperiments(h.apiData)
    assert.equal(cliExps.length, 1)
    assert.equal(apiExps.length, 1)
    assert.equal(cliExps[0]!.status, 'running')
    assert.equal(apiExps[0]!.status, 'running')
  } finally {
    await h.stop()
  }
})

test('Genesis experiments: CLI and HTTP API status transition parity for hold, scale, and kill verdicts', async () => {
  const h = await setup()
  try {
    type ExperimentSnapshot = {
      status: string
      measurements: Array<Record<string, unknown>>
      decisions: Array<Record<string, unknown>>
      [key: string]: unknown
    }
    const readExperiments = async (root: string) => JSON.parse(await readFile(join(root, 'nuera', h.runId, 'experiments.json'), 'utf8')) as ExperimentSnapshot[]
    const stripTimestamp = (record: Record<string, unknown>) => {
      const stable = { ...record }
      delete stable.at
      delete stable.startedAt
      delete stable.endsAt
      return stable
    }
    const normalize = (experiments: ExperimentSnapshot[]) => experiments.map((experiment) => ({
      ...stripTimestamp(experiment),
      measurements: experiment.measurements.map(stripTimestamp),
      decisions: experiment.decisions.map(stripTimestamp),
    }))

    // 1. Hold transition test (verdict hold -> status held)
    const holdDef = {
      id: 'exp-hold-parity',
      hypothesis: 'Testing hold verdict transition parity.',
      playbookId: 'genesis',
      metric: { id: 'metric-hold', label: 'Hold Metric', direction: 'higher-is-better', kill: 0.2, hold: 0.6, scale: 0.9 },
      budgetUsd: 30,
      durationDays: 14,
      customerFacing: false,
      proposedBy: 'entity-founder',
    }
    await h.runCliDraft(holdDef)
    const apiHoldDraftRes = await h.runApiDraft(holdDef)
    assert.equal(apiHoldDraftRes.status, 201)

    await h.runCliExperiment('experiment', 'start', holdDef.id)
    assert.equal((await h.runApiExperimentAction(holdDef.id, 'start')).status, 200)

    // Value 0.4 falls between kill (0.2) and hold (0.6) -> verdict 'hold'
    await h.runCliExperiment('measure', holdDef.id, '0.4', 'hold-source')
    assert.equal((await h.runApiExperimentAction(holdDef.id, 'measurements', { value: 0.4, source: 'hold-source' })).status, 201)

    await h.runCliExperiment('decide', holdDef.id, 'holding experiment')
    assert.equal((await h.runApiExperimentAction(holdDef.id, 'decide', { note: 'holding experiment' })).status, 200)

    let cliExps = await readExperiments(h.cliData)
    let apiExps = await readExperiments(h.apiData)
    const holdExpCli = cliExps.find((e) => e.definition && (e.definition as { id: string }).id === holdDef.id)
    const holdExpApi = apiExps.find((e) => e.definition && (e.definition as { id: string }).id === holdDef.id)
    assert.equal(holdExpCli?.status, 'held')
    assert.equal(holdExpApi?.status, 'held')
    assert.deepEqual(normalize(cliExps), normalize(apiExps), 'CLI and API store match after hold transition')

    // 2. Scale transition test (verdict scale -> status scaled)
    const scaleDef = {
      id: 'exp-scale-parity',
      hypothesis: 'Testing scale verdict transition parity.',
      playbookId: 'genesis',
      metric: { id: 'metric-scale', label: 'Scale Metric', direction: 'higher-is-better', kill: 0.2, hold: 0.6, scale: 0.9 },
      budgetUsd: 40,
      durationDays: 14,
      customerFacing: false,
      proposedBy: 'entity-founder',
    }
    await h.runCliDraft(scaleDef)
    assert.equal((await h.runApiDraft(scaleDef)).status, 201)

    await h.runCliExperiment('experiment', 'start', scaleDef.id)
    assert.equal((await h.runApiExperimentAction(scaleDef.id, 'start')).status, 200)

    // Value 0.95 >= scale (0.9) -> verdict 'scale'
    await h.runCliExperiment('measure', scaleDef.id, '0.95', 'scale-source')
    assert.equal((await h.runApiExperimentAction(scaleDef.id, 'measurements', { value: 0.95, source: 'scale-source' })).status, 201)

    await h.runCliExperiment('decide', scaleDef.id, 'scaling experiment')
    assert.equal((await h.runApiExperimentAction(scaleDef.id, 'decide', { note: 'scaling experiment' })).status, 200)

    cliExps = await readExperiments(h.cliData)
    apiExps = await readExperiments(h.apiData)
    const scaleExpCli = cliExps.find((e) => e.definition && (e.definition as { id: string }).id === scaleDef.id)
    const scaleExpApi = apiExps.find((e) => e.definition && (e.definition as { id: string }).id === scaleDef.id)
    assert.equal(scaleExpCli?.status, 'scaled')
    assert.equal(scaleExpApi?.status, 'scaled')
    assert.deepEqual(normalize(cliExps), normalize(apiExps), 'CLI and API store match after scale transition')

    // An experiment that is already scaled refuses further decisions on both sides
    await assert.rejects(h.runCliExperiment('decide', scaleDef.id, 'already scaled'), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /there is nothing to evaluate|already scaled/)
      return true
    })
    const repeatDecideApiRes = await h.runApiExperimentAction(scaleDef.id, 'decide', { note: 'already scaled' })
    assert.equal(repeatDecideApiRes.status, 409)
    const repeatDecideJson = await repeatDecideApiRes.json() as { error?: string }
    assert.match(repeatDecideJson.error ?? '', /there is nothing to evaluate|already scaled/)

    // 3. Kill transition test (verdict kill -> status killed)
    const killDef = {
      id: 'exp-kill-parity',
      hypothesis: 'Testing kill verdict transition parity.',
      playbookId: 'genesis',
      metric: { id: 'metric-kill', label: 'Kill Metric', direction: 'higher-is-better', kill: 0.2, hold: 0.6, scale: 0.9 },
      budgetUsd: 50,
      durationDays: 14,
      customerFacing: false,
      proposedBy: 'entity-founder',
    }
    await h.runCliDraft(killDef)
    assert.equal((await h.runApiDraft(killDef)).status, 201)

    await h.runCliExperiment('experiment', 'start', killDef.id)
    assert.equal((await h.runApiExperimentAction(killDef.id, 'start')).status, 200)

    // Value 0.1 <= kill (0.2) -> verdict 'kill'
    await h.runCliExperiment('measure', killDef.id, '0.1', 'kill-source')
    assert.equal((await h.runApiExperimentAction(killDef.id, 'measurements', { value: 0.1, source: 'kill-source' })).status, 201)

    await h.runCliExperiment('decide', killDef.id, 'killing experiment')
    assert.equal((await h.runApiExperimentAction(killDef.id, 'decide', { note: 'killing experiment' })).status, 200)

    cliExps = await readExperiments(h.cliData)
    apiExps = await readExperiments(h.apiData)
    const killExpCli = cliExps.find((e) => e.definition && (e.definition as { id: string }).id === killDef.id)
    const killExpApi = apiExps.find((e) => e.definition && (e.definition as { id: string }).id === killDef.id)
    assert.equal(killExpCli?.status, 'killed')
    assert.equal(killExpApi?.status, 'killed')
    assert.deepEqual(normalize(cliExps), normalize(apiExps), 'CLI and API store match after kill transition')

    // Refusal to measure an already killed experiment
    await assert.rejects(h.runCliExperiment('measure', killDef.id, '0.5', 'late-source'), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /Only a running or held experiment takes measurements/)
      return true
    })
    const lateMeasureApiRes = await h.runApiExperimentAction(killDef.id, 'measurements', { value: 0.5, source: 'late-source' })
    assert.equal(lateMeasureApiRes.status, 409)
    const lateMeasureJson = await lateMeasureApiRes.json() as { error?: string; reasons?: string[] }
    assert.match([lateMeasureJson.error, ...(lateMeasureJson.reasons ?? [])].join(' '), /Only a running or held experiment takes measurements/)

    // Final store parity check across all experiments
    assert.deepEqual(normalize(await readExperiments(h.cliData)), normalize(await readExperiments(h.apiData)), 'final store state matches across all experiments')
  } finally {
    await h.stop()
  }
})

