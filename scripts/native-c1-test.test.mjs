import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import { matrixCaseIds } from './native-c1-matrix.mjs'

// The C1 command must not report an empty pass: while the planned files are absent it
// refuses with exit 1, once they exist it runs Node's test runner, and the run must
// cover every case the matrix defines. A suite of placeholders is not the matrix.

const script = path.resolve('scripts/native-c1-test.mjs')
const temp = mkdtempSync(path.join(tmpdir(), 'native-c1-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))

const PLAN = [
  'quicksilver/test/c1/bootstrap.test.ts',
  'quicksilver/test/c1/tenancy.test.ts',
  'quicksilver/test/c1/revisions.test.ts',
  'quicksilver/test/c1/idempotency.test.ts',
  'quicksilver/test/c1/audit-atomicity.test.ts',
  'quicksilver/test/c1/input-bounds.test.ts',
  'quicksilver/test/c1/queries.test.ts',
  'quicksilver/test/c1/fixtures/two-tenants.ts',
]

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

const MATRIX_IDS = [...matrixCaseIds(readFileSync(path.resolve('docs/platform/native-cms-c1-acceptance-test-matrix.md'), 'utf8'))]

/**
 * Writes every planned file. Each test file gets a share of `covered` as tests
 * named after matrix IDs, so the fixture exercises the same accounting as the
 * real suite.
 */
function writePlanned(root, covered = MATRIX_IDS) {
  const suites = PLAN.filter((file) => file.endsWith('.test.ts'))
  const per = Math.ceil(covered.length / suites.length)
  suites.forEach((file, index) => {
    const ids = covered.slice(index * per, (index + 1) * per)
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(
      target,
      `import { test } from 'node:test'\n${ids.map((id) => `test('${id} fixture case', () => {})`).join('\n')}\n`,
    )
  })
  const fixtures = path.join(root, PLAN.find((file) => file.endsWith('two-tenants.ts')))
  mkdirSync(path.dirname(fixtures), { recursive: true })
  writeFileSync(fixtures, 'export const tenants = ["tenant-a", "tenant-b"]\n')
}

test('refuses closed while the C1 files are missing, and names them', () => {
  const result = run('--root', path.join(temp, 'empty'))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /C1 IS NOT IMPLEMENTED: 8 of 8/)
  assert.match(result.stderr, /bootstrap\.test\.ts/)
  assert.match(result.stderr, /This is not a pass\./)
  assert.doesNotMatch(result.stdout, /pass/)
})

test('--list reports every planned file and its state', () => {
  const result = run('--list', '--root', path.join(temp, 'empty'))
  assert.equal(result.status, 0)
  const lines = result.stdout.trim().split('\n')
  assert.equal(lines.length, PLAN.length)
  for (const file of PLAN) assert.match(result.stdout, new RegExp(file.replace(/[.]/g, '\\.') + '\\s+missing'))
})

test('runs the suite once every planned file exists and covers the matrix', () => {
  const root = path.join(temp, 'complete')
  writePlanned(root)
  const result = run('--root', root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /C1 matrix: 50\/50 cases ran, 50 passed, 0 skipped, 0 todo\./)
})

test('a complete file set that omits a matrix case fails instead of passing', () => {
  const root = path.join(temp, 'incomplete')
  writePlanned(root, MATRIX_IDS.slice(1))
  const result = run('--root', root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /C1 MATRIX GATE FAILED/)
  assert.match(result.stderr, new RegExp(`no test reported 1 matrix case\\(s\\): ${MATRIX_IDS[0]}`))
  assert.match(result.stderr, /This is not a pass\./)
})

test('an unknown flag is invalid input', () => {
  const result = run('--nope')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /usage: native-c1-test/)
})

test('--root without a value is invalid input', () => {
  const result = run('--root')
  assert.equal(result.status, 2)
})
