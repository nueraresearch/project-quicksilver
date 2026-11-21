import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const script = path.resolve('scripts/native-capability-matrix.mjs')
const root = process.cwd()
const temp = mkdtempSync(path.join(tmpdir(), 'native-matrix-'))
after(() => rmSync(temp, { recursive: true, force: true }))

const env = { ...process.env }
delete env.NODE_TEST_CONTEXT

function baseMatrix() {
  return {
    version: 1,
    updated: '2026-11-10',
    gate: 'default-backend removal gate',
    providers: [
      { id: 'sanity', status: 'required', r1: 'keep until parity' },
      { id: 'stripe', status: 'optional', r1: 'optional only' },
    ],
    capabilities: [
      {
        id: 'content.decisions',
        provider: 'sanity',
        feature: 'Decision records',
        core: true,
        native: 'native',
        externalRequired: false,
        evidence: ['packages/agent/src/local-structured-output.test.ts'],
        gaps: '',
        r1: 'replaced only with parity evidence',
      },
      {
        id: 'payments.stripe',
        provider: 'stripe',
        feature: 'Payments',
        core: false,
        native: 'absent',
        externalRequired: true,
        evidence: ['docs/platform/native-local.md'],
        gaps: 'needs an account when used',
        r1: 'optional',
      },
    ],
  }
}

function fixture(name, matrix) {
  const file = path.join(temp, name)
  writeFileSync(file, typeof matrix === 'string' ? matrix : JSON.stringify(matrix, null, 2))
  return file
}

function run(file, ...rest) {
  return spawnSync(process.execPath, [script, file, ...rest], { cwd: root, env, encoding: 'utf8' })
}

test('a complete matrix passes with exit 0', () => {
  const result = run(fixture('complete.json', baseMatrix()))
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /REMOVAL GATE PASSED: all 1 core capabilities are native/)
})

test('an optional non-native capability does not block the gate', () => {
  const matrix = baseMatrix()
  matrix.capabilities.push({
    id: 'phone.twilio',
    provider: 'stripe',
    feature: 'Phone',
    core: false,
    native: 'absent',
    externalRequired: true,
    evidence: ['docs/platform/native-local.md'],
    gaps: 'carrier required',
    r1: 'optional',
  })
  const result = run(fixture('optional.json', matrix))
  assert.equal(result.status, 0, result.stderr)
})

test('a non-native core capability blocks with exit 1 and names the gap', () => {
  const matrix = baseMatrix()
  matrix.capabilities[0].native = 'partial'
  matrix.capabilities[0].gaps = 'no native decision store'
  const result = run(fixture('blocked.json', matrix))
  assert.equal(result.status, 1)
  assert.match(result.stdout, /REMOVAL GATE BLOCKED: 1 of 1 core capabilities/)
  assert.match(result.stdout, /content\.decisions \[sanity\/partial\]: no native decision store/)
  assert.match(result.stdout, /This is not a pass/)
})

test('a native claim without a test as evidence is invalid input, not a pass', () => {
  const matrix = baseMatrix()
  matrix.capabilities[0].evidence = ['docs/platform/native-local.md']
  const result = run(fixture('no-test.json', matrix))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /claims native without a test as evidence/)
  assert.match(result.stderr, /This is not a pass/)
})

test('a missing evidence path is invalid input', () => {
  const matrix = baseMatrix()
  matrix.capabilities[0].native = 'partial'
  matrix.capabilities[0].evidence = ['docs/platform/does-not-exist.md']
  const result = run(fixture('missing-evidence.json', matrix))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /does not exist/)
})

test('a duplicate capability id is invalid input', () => {
  const matrix = baseMatrix()
  matrix.capabilities.push({ ...matrix.capabilities[0] })
  const result = run(fixture('duplicate.json', matrix))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /duplicate capability id: content\.decisions/)
})

test('an empty matrix file is invalid input, never an empty pass', () => {
  const result = run(fixture('empty.json', ''))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /is empty/)
})

test('malformed JSON is invalid input', () => {
  const result = run(fixture('broken.json', '{'))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /not valid JSON/)
})

// Prevents: a mistyped flag such as `--jsn` falling back to human output while
// still exiting 0, so a caller that parses the JSON sees prose and no error.
test('an unknown flag is invalid input, not silently ignored', () => {
  const result = run(fixture('complete.json', baseMatrix()), '--jsn')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unknown option --jsn/)
  assert.match(result.stderr, /This is not a pass/)
})

// Prevents: a second matrix path being dropped while the gate reports on the
// first, which reads as a pass over the file the caller meant to check.
test('a second positional argument is rejected', () => {
  const result = run(fixture('complete.json', baseMatrix()), fixture('other.json', baseMatrix()))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unexpected argument/)
})

// Prevents: a parser that reads the value after a flag as its argument, which
// would demand JSON from a path that is not there.
test('--json before the matrix path is still a flag, not a filename', () => {
  const file = fixture('complete.json', baseMatrix())
  const result = spawnSync(process.execPath, [script, '--json', file], { cwd: root, env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).passed, true)
})

test('--json still selects machine output', () => {
  const result = run(fixture('complete.json', baseMatrix()), '--json')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).passed, true)
})
