import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

// A gate that exists but is not run is the same as a gate that was never
// written. The runner discovers files instead of naming them, so these tests
// pin both directions: it runs what is there, and it refuses to report a pass
// over nothing.

const script = path.resolve('scripts/native-c1-run.mjs')
const temp = mkdtempSync(path.join(tmpdir(), 'native-c1-run-'))
after(() => rmSync(temp, { recursive: true, force: true }))

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: process.cwd() })

function gateFile(directory, name, label) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, name),
    `import { test } from 'node:test'\ntest('${label}', () => {})\n`,
  )
}

test('runs every gate file it finds, including nested ones', () => {
  const directory = path.join(temp, 'gates')
  gateFile(directory, 'alpha.test.ts', 'alpha gate ran')
  gateFile(path.join(directory, 'nested'), 'beta.test.ts', 'beta gate ran')
  const result = run(directory)
  const output = `${result.stdout}${result.stderr}`
  assert.equal(result.status, 0, output)
  assert.match(output, /alpha gate ran/)
  assert.match(output, /beta gate ran/)
  assert.match(output, /C1 gate: running 2 file\(s\)/)
})

test('an empty discovery fails instead of reporting an empty pass', () => {
  const directory = path.join(temp, 'empty')
  mkdirSync(directory, { recursive: true })
  const result = run(directory)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no \*\.test\.ts files/)
  assert.match(result.stderr, /This is not a pass/)
  assert.doesNotMatch(result.stdout, /pass/)
})

test('a missing directory and an unknown option are refusals, not passes', () => {
  const missing = run(path.join(temp, 'absent'))
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /does not exist/)

  const badFlag = run('--nope')
  assert.equal(badFlag.status, 2)
  assert.match(badFlag.stderr, /unknown option --nope/)
})
