import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

// The totals check sees counts; this one sees the row names in the sentence that
// says which rows are native, partial and absent. That sentence drifted once, so
// every failure below is paired with the same fixture unedited: the difference is
// the row's status, not the sentence's shape.

const script = path.resolve('scripts/native-capability-enumeration.mjs')
const matrixPath = path.resolve('docs/platform/native-capabilities.json')
const docPath = path.resolve('docs/platform/native-local.md')
const temp = mkdtempSync(path.join(tmpdir(), 'capability-enumeration-'))
after(() => rmSync(temp, { recursive: true, force: true }))

const MATRIX = JSON.parse(readFileSync(matrixPath, 'utf8'))
const SENTENCE = readFileSync(docPath, 'utf8').match(/A blocked gate is the expected state today:[\s\S]*?are absent\./)?.[0]
assert.ok(SENTENCE, 'the source doc must carry the enumeration sentence')

let counter = 0
function fixture(text) {
  const file = path.join(temp, `doc-${++counter}.md`)
  writeFileSync(file, `# fixture\n\n${text}\n`)
  return file
}

function matrixWith(mutate) {
  const copy = JSON.parse(JSON.stringify(MATRIX))
  mutate(copy.capabilities)
  const file = path.join(temp, `matrix-${++counter}.json`)
  writeFileSync(file, JSON.stringify(copy))
  return file
}

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: process.cwd() })
const runDoc = (file, matrix = matrixPath) => run('--docs', file, '--matrix', matrix)

test('the committed sentence names every core row in its matrix group', () => {
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /capability enumeration: \d+ sentence\(s\) name all 23 core rows/)
})

test('the unchanged fixture passes while a row that changed status fails', () => {
  const doc = fixture(SENTENCE)
  const clean = runDoc(doc)
  assert.equal(clean.status, 0, clean.stderr)

  // The check exists for this: the matrix moved, the sentence did not.
  const moved = matrixWith((rows) => {
    rows.find((row) => row.id === 'content.query.tenant').native = 'native'
  })
  const result = runDoc(doc, moved)
  assert.equal(result.status, 1)
  assert.match(
    result.stderr,
    /content\.query\.tenant is native in the matrix but the sentence lists "tenant-scoped query contracts" under partial\./,
  )
  assert.match(result.stderr, /This is not a pass\./)
})

test('a row that moved to absent is caught in the other direction', () => {
  const moved = matrixWith((rows) => {
    rows.find((row) => row.id === 'email.smtp-submission').native = 'absent'
  })
  const result = runDoc(fixture(SENTENCE), moved)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /email\.smtp-submission is absent in the matrix but the sentence lists "SMTP submission" under partial\./)
})

test('a row the sentence stops naming fails even when the matrix agrees with the rest', () => {
  // The sentence wraps across lines, so remove the phrase wherever the break falls.
  const doc = fixture(SENTENCE.replace(/tenant-scoped query\s+contracts,\s*/, ''))
  const result = runDoc(doc)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /does not name content\.query\.tenant \("tenant-scoped query contracts"\)/)
})

test('a new core row no phrase covers fails instead of passing unnoticed', () => {
  const grown = matrixWith((rows) => {
    rows.push({ id: 'content.new-surface', provider: 'sanity', feature: 'New surface', core: true, native: 'absent' })
  })
  const result = runDoc(fixture(SENTENCE), grown)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /does not name content\.new-surface; add a phrase for every core row\./)
})

test('an id the matrix no longer defines fails instead of lingering in the sentence', () => {
  const shrunk = matrixWith((rows) => {
    const index = rows.findIndex((row) => row.id === 'email.starttls')
    rows.splice(index, 1)
  })
  const result = runDoc(fixture(SENTENCE), shrunk)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /names email\.starttls, which .* does not define\./)
})

test('docs without the sentence fail instead of passing over nothing', () => {
  const doc = fixture('# no enumeration here\n')
  const result = runDoc(doc)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /would verify nothing/)
})

test('a missing or malformed matrix is invalid input, not a pass', () => {
  const doc = fixture(SENTENCE)

  const missing = runDoc(doc, path.join(temp, 'absent.json'))
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /cannot read/)

  const broken = path.join(temp, 'broken.json')
  writeFileSync(broken, '{')
  const malformed = runDoc(doc, broken)
  assert.equal(malformed.status, 2)
  assert.match(malformed.stderr, /not valid JSON/)
})

test('an unknown argument is invalid input', () => {
  const result = run('--nope')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unknown argument: --nope/)
})
