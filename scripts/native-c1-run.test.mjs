import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import { checkMatrixRun, matrixCaseIds } from './native-c1-matrix.mjs'
import { MUTATIONS } from './native-c1-mutations.mjs'

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

// A provocation whose guard text has drifted becomes a silent no-op: the edit
// applies to nothing, the suite still passes, and the run claims the guard was
// checked. Pin the literal target of every mutation.
test('every guard-removal mutation still has a unique target and a real gate file', () => {
  for (const mutation of MUTATIONS) {
    const source = readFileSync(path.resolve(mutation.file), 'utf8')
    assert.equal(
      source.split(mutation.from).length - 1,
      1,
      `${mutation.id}: the guard text must occur exactly once in ${mutation.file}`,
    )
    assert.ok(existsSync(path.resolve(mutation.gate)), `${mutation.id}: ${mutation.gate} does not exist`)
  }
})

// Stage 8 closes the gate on the matrix, not on file count: a deleted case, a
// skip or a todo must fail even when every test that ran passed.
const matrixText = readFileSync(path.resolve('docs/platform/native-cms-c1-acceptance-test-matrix.md'), 'utf8')

function syntheticRun(ids) {
  return [
    ...ids.map((id) => `✔ ${id} case`),
    `ℹ tests ${ids.length}`,
    `ℹ pass ${ids.length}`,
    'ℹ fail 0',
    'ℹ skipped 0',
    'ℹ todo 0',
  ].join('\n')
}

test('the matrix defines 50 cases and a full passing run satisfies the gate', () => {
  const ids = [...matrixCaseIds(matrixText)]
  assert.equal(ids.length, 50, 'the matrix table must define exactly 50 cases')
  const check = checkMatrixRun({ output: syntheticRun(ids), markdown: matrixText, status: 0 })
  assert.deepEqual(check.problems, [])
  assert.equal(check.covered, 50)
})

test('the gate refuses a missing case, a failed case, a skip or todo, and an undefined case', () => {
  const ids = [...matrixCaseIds(matrixText)]
  const problems = (check) => check.problems.join('\n')

  const missing = checkMatrixRun({ output: syntheticRun(ids.slice(1)), markdown: matrixText, status: 0 })
  assert.match(problems(missing), /no test reported 1 matrix case/)
  assert.match(problems(missing), new RegExp(ids[0]))

  const failed = checkMatrixRun({
    output: syntheticRun(ids).replace(`✔ ${ids[0]} case`, `✖ ${ids[0]} case`),
    markdown: matrixText,
    status: 0,
  })
  assert.match(problems(failed), new RegExp(`cases that did not pass: ${ids[0]}`))

  const skipped = checkMatrixRun({ output: `${syntheticRun(ids)}\nℹ skipped 1`, markdown: matrixText, status: 0 })
  assert.match(problems(skipped), /1 test\(s\) skipped/)

  const todo = checkMatrixRun({ output: `${syntheticRun(ids)}\nℹ todo 1`, markdown: matrixText, status: 0 })
  assert.match(problems(todo), /1 test\(s\) todo/)

  const unknown = checkMatrixRun({ output: `${syntheticRun(ids)}\n✔ C1-A99 invented case`, markdown: matrixText, status: 0 })
  assert.match(problems(unknown), /does not define: C1-A99/)

  const nonzero = checkMatrixRun({ output: syntheticRun(ids), markdown: matrixText, status: 1 })
  assert.match(problems(nonzero), /exited 1/)
})
