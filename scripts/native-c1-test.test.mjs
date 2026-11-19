import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

// The C1 command must not report an empty pass: while the planned files are absent it
// refuses with exit 1, and it only runs Node's test runner once they all exist.

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

test('runs the suite once every planned file exists', () => {
  const root = path.join(temp, 'complete')
  for (const file of PLAN) {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(
      target,
      file.endsWith('two-tenants.ts')
        ? 'export const tenants = ["tenant-a", "tenant-b"]\n'
        : "import { test } from 'node:test'\ntest('placeholder', () => {})\n",
    )
  }
  const result = run('--root', root)
  assert.equal(result.status, 0, result.stderr)
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
