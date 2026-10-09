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
