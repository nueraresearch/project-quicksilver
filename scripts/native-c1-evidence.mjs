#!/usr/bin/env node
/**
 * Produces the redacted C1 evidence artifacts (matrix §2.5; implementation
 * sequence Stage 8): `c1-acceptance-report` and `c1-query-contract-report`.
 *
 * It runs the matrix gate and the guard-removal provocation itself, so the
 * artifacts describe a run that just happened rather than a remembered one, and
 * it refuses to write anything unless both are green. Contents are limited to
 * commands, counts, matrix IDs, digests and metadata: no record bodies, ids or
 * tenant names. A private-input check rejects anything that looks like one.
 *
 * C0 inputs and owner sign-off are not inputs this repository can supply, so
 * the artifacts mark them blocked instead of claiming an exit.
 *
 * Usage: native-c1-evidence [--check]
 *   --check  compare a fresh run with the committed artifacts; write nothing
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkMatrixRun, matrixCaseIds, runCaseResults } from './native-c1-matrix.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const MATRIX_FILE = 'docs/platform/native-cms-c1-acceptance-test-matrix.md'
const OUTPUT_DIR = 'docs/platform/native-cms-c1-evidence'
const ADAPTER = 'direct native repositories (no external CMS host); in-memory MemoryStore fixture adapter'
const COMMAND = 'npm run native:c1:test'
const PRIVATE = /\btenant-[ab]\b|\bshared-(root|graph|agent|lineage)\b|\btenant-b-graph\b/

const check = process.argv.includes('--check')
for (const argument of process.argv.slice(2)) {
  if (argument !== '--check') {
    console.error(`unknown argument: ${argument}\nusage: native-c1-evidence [--check]`)
    process.exit(2)
  }
}

const shell = process.platform === 'win32'
const env = { ...process.env, FORCE_COLOR: '0' }
delete env.NODE_TEST_CONTEXT

function fail(message, output = '') {
  console.error(`${message}${output ? `\n${output}` : ''}`)
  process.exit(1)
}

// 1. The matrix run.
const gate = spawnSync('npm', ['run', '--silent', 'native:c1:test'], { cwd: root, encoding: 'utf8', shell, env })
const gateOutput = `${gate.stdout ?? ''}\n${gate.stderr ?? ''}`
if (gate.status !== 0) fail('C1 EVIDENCE FAILED: the matrix gate is not green.', gateOutput)

const matrix = readFileSync(join(root, MATRIX_FILE), 'utf8')
const accounting = checkMatrixRun({ output: gateOutput, markdown: matrix, status: gate.status })
if (accounting.problems.length > 0) fail(`C1 EVIDENCE FAILED: ${accounting.problems.join('; ')}`, gateOutput)

// 2. Guard-removal provocation.
const provoke = spawnSync(process.execPath, [join(root, 'scripts/native-c1-provoke.mjs'), '--json'], {
  cwd: root,
  encoding: 'utf8',
  env,
})
let provocation
try {
  provocation = JSON.parse(provoke.stdout)
} catch {
  fail('C1 EVIDENCE FAILED: the guard-removal provocation did not report JSON.', `${provoke.stdout ?? ''}${provoke.stderr ?? ''}`)
}
if (provoke.status !== 0 || !provocation.ok) {
  fail('C1 EVIDENCE FAILED: a removed guard was not caught by its positive control.', provoke.stderr ?? '')
}

// 3. Redaction-safe manifest digests.
const digest = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--no-warnings', join(root, 'scripts/native-c1-fixture-digest.ts')],
  { cwd: root, encoding: 'utf8', env },
)
let manifest
try {
  manifest = JSON.parse(digest.stdout)
} catch {
  fail('C1 EVIDENCE FAILED: the fixture manifest digest could not be computed.', `${digest.stdout ?? ''}${digest.stderr ?? ''}`)
}

// The report names the commit it tested, so the paths that decide the run must be
// committed. Unrelated working-tree changes elsewhere are not part of this claim.
const inputs = [
  'quicksilver',
  'scripts/native-c1-test.mjs',
  'scripts/native-c1-run.mjs',
  'scripts/native-c1-matrix.mjs',
  'scripts/native-c1-mutations.mjs',
  'scripts/native-c1-provoke.mjs',
  'scripts/native-c1-fixture-digest.ts',
  'scripts/native-c1-evidence.mjs',
  'scripts/native-c1-run.test.mjs',
  'scripts/native-c1-test.test.mjs',
  MATRIX_FILE,
]
const dirty = spawnSync('git', ['status', '--porcelain', '--', ...inputs], { cwd: root, encoding: 'utf8' }).stdout?.trim()
if (dirty) fail(`C1 EVIDENCE FAILED: commit the matrix inputs first; the report must name the commit it tested.\n${dirty}`)

const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || 'unknown'
const timestamp = new Date().toISOString()
const results = runCaseResults(gateOutput)
const ids = [...matrixCaseIds(matrix)]
const gates = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((gateName) => {
  const members = ids.filter((id) => id.startsWith(`C1-${gateName}`))
  return { gate: gateName, cases: members, passed: members.filter((id) => results.get(id) === 'pass').length }
})

const counts = accounting.counts
const header = [
  `- **Command:** \`${COMMAND}\``,
  `- **Commit under test:** \`${commit}\``,
  '- **Artifact commit:** a later, documentation-only commit; the code under test is the commit above.',
  `- **Adapter:** ${ADAPTER}`,
  `- **Schema version:** \`${manifest.schemaVersion}\``,
  `- **Schema catalog digest:** \`${manifest.schemaCatalogDigest}\``,
  `- **Relation inventory digest:** \`${manifest.relationInventoryDigest}\``,
  `- **Fixture manifest digest:** \`${manifest.fixtureDigest}\` (${manifest.fixtureTables} tables, row counts only)`,
  `- **Timestamp:** ${timestamp}`,
  `- **Counts:** ${counts.tests} tests, ${counts.pass} pass, ${counts.fail} fail, ${counts.skipped} skipped, ${counts.todo} todo; ${accounting.covered}/${accounting.expected} matrix cases reported`,
  '- **Redaction:** commands, counts, matrix IDs and digests only; no record bodies, record IDs, tenant names or private paths.',
]

const acceptance = [
  '# C1 acceptance report',
  '',
  '**Status: matrix green on synthetic fixtures — not C1 sign-off.** C0 inputs and owner sign-off remain blocked (below). A green fixture suite is repository evidence, not migration evidence.',
  '',
  ...header,
  '',
  '## Gate accounting',
  '',
  '| Gate | Cases | Passed | Result |',
  '|---|---:|---:|---|',
  ...gates.map(({ gate: name, cases, passed }) => `| ${name} | ${cases.length} | ${passed} | ${passed === cases.length ? 'pass' : 'fail'} |`),
  `| **Total** | **${ids.length}** | **${ids.filter((id) => results.get(id) === 'pass').length}** | **${accounting.problems.length === 0 ? 'pass' : 'fail'}** |`,
  '',
  '## Matrix IDs exercised',
  '',
  ...gates.map(({ gate: name, cases }) => `- ${name}: ${cases.map((id) => `\`${id}\``).join(', ')}`),
  '',
  '## Guard-removal provocation',
  '',
  'Each guard below was removed in a temporary copy of `quicksilver/`; the unmutated copy passed first, and the named positive control had to fail. A mutation that still passed would fail this report.',
  '',
  '| Guard removed | Case that must fail | Caught |',
  '|---|---|---|',
  ...provocation.mutations.map(
    ({ guard, expectCase, caught }) => `| ${guard} | \`${expectCase}\` | ${caught ? 'yes' : '**no**'} |`,
  ),
  '',
  '## Blocked inputs (not satisfied by this report)',
  '',
  '- Signed C0 ownership manifest with zero ambiguous, unresolved or blocked records.',
  '- Production read-only export digest and asset/deletion baseline digest.',
  '- C1 entry bundle (owner + Security reviewer signature) and owner sign-off of the exit bundle.',
  '- Security review confirming the committed evidence is redacted.',
  '',
  '## What this does not prove',
  '',
  '- Nothing was migrated, imported or tombstoned; no provider status changed and no route is wired.',
  '- The adapter here is the in-memory fixture store, not the production persistence adapter.',
  '- `npm run verify` was not run end to end as part of this artifact; the matrix gate is one stage of it.',
  '',
]

const contracts = [
  ['getCapabilityGraph', 'C1-G01', 'capability graph fixture (inheritance, dependency, conflict, cycle/dangling refusal)'],
  ['findContradictions', 'C1-G02', 'policy conflict, evidence contradiction, metric drift; 200-finding cap'],
  ['getWorkflowDAG', 'C1-G03', 'active head, unpublished/stale/foreign null, malformed/cyclic refusal'],
  ['getObjectiveTree', 'C1-G04', 'three-level tree, orphan/cycle refusal, depth/node bounds'],
  ['getEvidenceForMetric', 'C1-G05', 'direct evidence, contradiction, tombstoned exclusion, 500-row cap'],
  ['getDecisionHistory', 'C1-G06', 'proposed→approved→executed chain, rollback, filters, cursor, paging'],
  ['all six', 'C1-G07', 'public entry points, typed results, blank-tenant refusal, no TODO, no write'],
  ['getCapabilityGraph + findContradictions', 'C1-B10', 'foreign-ID empty results with no write'],
]

const queryReport = [
  '# C1 query contract report',
  '',
  '**Status: the six §7 contracts are implemented and green on synthetic fixtures.** C0 inputs and sign-off remain blocked; this is not route wiring or a public API.',
  '',
  ...header,
  '',
  '## Contracts',
  '',
  '| Contract | Case | Fixture | Result |',
  '|---|---|---|---|',
  ...contracts.map(
    ([contract, id, fixture]) => `| \`${contract}\` | \`${id}\` | ${fixture} | ${results.get(id) === 'pass' ? 'pass' : 'fail'} |`,
  ),
  '',
  '## Stub check',
  '',
  '- `quicksilver/query/index.ts` exports the six named entry points, each delegating to `quicksilver/cms/queries.ts`; no TODO or "not implemented" text remains.',
  '- `C1-G07` executes every public entry point and requires fixture-backed data, so an unconditional empty return fails the case.',
  '- The blank-tenant refusal is the paired control: a stub that returns an empty result cannot raise `MalformedQuery`.',
  '',
  '## Tenant, ordering and no-write rules',
  '',
  '- Every contract takes `tenantId` as a required argument; a missing or blank value refuses with `MalformedQuery` before any read.',
  '- A foreign or missing ID returns the contract\'s empty or null result; no foreign row is returned and scope is never widened.',
  '- Ordering, caps and truncation are asserted by `C1-G01`–`C1-G06` (nodes by id, edges by (from,to,kind), findings by (kind,id), pre-order by (name,id), evidence newest-first, events by (at,seq,eventId)).',
  '- Read-only is structural: the contracts are typed against `QueryStore`, which exposes `rows` and `findById` only, so no write method is reachable. `C1-G07` also snapshots every catalog table for tenant A before and after the six calls and requires an unchanged digest.',
  '',
  '## Blocked inputs',
  '',
  'The same C0 ownership manifest, production export and asset/deletion baseline digests, entry bundle and sign-off listed in `c1-acceptance-report` remain blocked. C2 route adaptation must not start from this report alone.',
  '',
]

for (const [name, text] of [
  ['c1-acceptance-report.md', acceptance.join('\n')],
  ['c1-query-contract-report.md', queryReport.join('\n')],
]) {
  const leak = text.match(PRIVATE)
  if (leak) fail(`C1 EVIDENCE FAILED: ${name} is not redacted (found ${leak[0]}).`)
}

const directory = join(root, OUTPUT_DIR)
const files = [
  ['c1-acceptance-report.md', acceptance.join('\n')],
  ['c1-query-contract-report.md', queryReport.join('\n')],
]

if (check) {
  const stale = files.filter(([name, text]) => {
    const path = join(directory, name)
    if (!existsSync(path)) return true
    const committed = readFileSync(path, 'utf8')
    // Timestamps and the commit line legitimately change between runs.
    const normalize = (value) => value.replace(/^- \*\*(Timestamp|Commit under test):\*\*.*$/gm, '')
    return normalize(committed) !== normalize(text)
  })
  if (stale.length > 0) fail(`C1 EVIDENCE FAILED: stale artifact(s): ${stale.map(([name]) => name).join(', ')}`)
  console.log('C1 evidence: committed artifacts match a fresh green run.')
  process.exit(0)
}

mkdirSync(directory, { recursive: true })
for (const [name, text] of files) writeFileSync(join(directory, name), text)

console.log(
  `C1 evidence: wrote ${files.length} artifacts to ${OUTPUT_DIR}; ${accounting.covered}/${accounting.expected} cases, ${provocation.mutations.length}/${provocation.mutations.length} guard removals caught.`,
)
