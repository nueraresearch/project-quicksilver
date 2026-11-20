import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

// The removal gate's totals are quoted in the native CMS docs, and a row change
// that leaves a quote behind is a claim the matrix no longer supports. Every
// drift case is paired with the same fixture unedited, so a failing check is
// proven to fail for the number rather than for the sentence shape.

const script = path.resolve('scripts/native-capability-totals.mjs')
const matrix = path.resolve('docs/platform/native-capabilities.json')
const temp = mkdtempSync(path.join(tmpdir(), 'capability-totals-'))
after(() => rmSync(temp, { recursive: true, force: true }))

let counter = 0
function fixture(text, extension = 'md') {
  const file = path.join(temp, `doc-${++counter}.${extension}`)
  writeFileSync(file, text)
  return file
}

/** A throwaway tree shaped like the repository: a matrix, docs/ and the module README. */
function fixtureRoot(name, files) {
  const root = path.join(temp, name)
  for (const [relative, text] of Object.entries(files)) {
    const target = path.join(root, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  return root
}

// 2 core rows (1 native, 1 partial), 3 content rows (1 of each).
const FIXTURE_MATRIX = JSON.stringify({
  capabilities: [
    { id: 'content.decisions', core: true, native: 'native' },
    { id: 'content.query', core: true, native: 'partial' },
    { id: 'content.chat', core: false, native: 'absent' },
  ],
})

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: process.cwd() })

test('the committed docs quote the committed matrix', () => {
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /capability totals: \d+ quoted block\(s\)/)
  // Discovery is the whole docs tree, not a short list that could miss a new doc.
  const scanned = Number(/in (\d+) doc\(s\)/.exec(result.stdout)?.[1])
  assert.ok(scanned > 50, `expected the docs tree to be scanned, got ${scanned} doc(s)`)
})

test('a drifted core total fails while the same fixture unedited passes', () => {
  const good = fixture('- **23 core capabilities:** 1 native, 6 partial, 16 absent.\n')
  const goodRun = run('--docs', good, '--matrix', matrix)
  assert.equal(goodRun.status, 0, goodRun.stderr)

  const bad = fixture('- **23 core capabilities:** 1 native, 5 partial, 17 absent.\n')
  const badRun = run('--docs', bad, '--matrix', matrix)
  assert.equal(badRun.status, 1)
  assert.match(badRun.stderr, /CAPABILITY TOTALS FAILED/)
  assert.match(badRun.stderr, /doc-\d+\.md:1 core: quoted 1 native, 5 partial, 17 absent of 23/)
  assert.match(badRun.stderr, /the matrix has 1 native, 6 partial, 16 absent of 23/)
  assert.match(badRun.stderr, /This is not a pass\./)
})

test('one drifted field fails, including a stale content total', () => {
  const bad = fixture('- **14 content capabilities:** 0 native, 4 partial, 10 absent.\n')
  const result = run('--docs', bad, '--matrix', matrix)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /content: quoted 0 native, 4 partial, 10 absent of 14/)
  assert.match(result.stderr, /the matrix has 0 native, 5 partial, 9 absent of 14/)
})

// The status split can be right while the count it describes is wrong; a check
// that only compared the three statuses would pass this line.
test('a wrong capability count fails even when the status split is right', () => {
  const bad = fixture('- **22 core capabilities:** 1 native, 6 partial, 16 absent.\n')
  const result = run('--docs', bad, '--matrix', matrix)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /quoted 1 native, 6 partial, 16 absent of 22/)
  assert.match(result.stderr, /the matrix has 1 native, 6 partial, 16 absent of 23/)
})

test('a doc set that quotes nothing fails instead of passing over nothing', () => {
  const empty = fixture('# capability matrix\n\nNo totals quoted here.\n')
  const result = run('--docs', empty, '--matrix', matrix)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /would verify nothing/)
})

// The point of widening discovery: a doc that starts quoting totals later is
// checked without anyone adding it to a list. This one is three levels deep.
test('a new markdown file anywhere under docs/ is discovered and checked', () => {
  const drifted = fixtureRoot('tree-drift', {
    'docs/platform/native-capabilities.json': FIXTURE_MATRIX,
    'docs/platform/new/deep/report.md': '- **2 core capabilities:** 1 native, 0 partial, 1 absent.\n',
    'quicksilver/README.md': '- **3 content capabilities:** 1 native, 1 partial, 1 absent.\n',
  })
  const badRun = run('--root', drifted)
  assert.equal(badRun.status, 1)
  assert.match(badRun.stderr, /docs\/platform\/new\/deep\/report\.md:1 core: quoted 1 native, 0 partial, 1 absent of 2/)
  assert.match(badRun.stderr, /the matrix has 1 native, 1 partial, 0 absent of 2/)

  const clean = fixtureRoot('tree-clean', {
    'docs/platform/native-capabilities.json': FIXTURE_MATRIX,
    'docs/platform/new/deep/report.md': '- **2 core capabilities:** 1 native, 1 partial, 0 absent.\n',
    'quicksilver/README.md': '- **3 content capabilities:** 1 native, 1 partial, 1 absent.\n',
  })
  const cleanRun = run('--root', clean)
  assert.equal(cleanRun.status, 0, cleanRun.stderr)
  // Only the two markdown files are scanned; the JSON matrix is not a doc.
  assert.match(cleanRun.stdout, /2 quoted block\(s\) in 2 doc\(s\)/)
})

test('quicksilver/README.md is scanned like any other doc', () => {
  const root = fixtureRoot('readme', {
    'docs/platform/native-capabilities.json': FIXTURE_MATRIX,
    'docs/guide.md': '# guide\n',
    'quicksilver/README.md': '- **3 content capabilities:** 1 native, 0 partial, 2 absent.\n',
  })
  const result = run('--root', root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /quicksilver\/README\.md:1 content: quoted 1 native, 0 partial, 2 absent of 3/)
})

test('a scanned tree that quotes nothing still fails', () => {
  const root = fixtureRoot('silent', {
    'docs/platform/native-capabilities.json': FIXTURE_MATRIX,
    'docs/guide.md': '# guide\n',
    'quicksilver/README.md': '# module\n',
  })
  const result = run('--root', root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no doc quotes capability totals in 2 scanned file\(s\)/)
  assert.match(result.stderr, /would verify nothing/)
})

test('--root without a docs/ directory is invalid input', () => {
  const root = fixtureRoot('no-docs', { 'quicksilver/README.md': '# module\n' })
  const result = run('--root', root)
  assert.equal(result.status, 2)
  assert.match(result.stderr, /cannot read .*docs/)
})

test('a missing or malformed matrix is invalid input, not a pass', () => {
  const doc = fixture('- **23 core capabilities:** 1 native, 6 partial, 16 absent.\n')

  const missing = run('--docs', doc, '--matrix', path.join(temp, 'absent.json'))
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /cannot read/)

  const broken = fixture('{', 'json')
  const malformed = run('--docs', doc, '--matrix', broken)
  assert.equal(malformed.status, 2)
  assert.match(malformed.stderr, /not valid JSON/)
})

// A status outside the three would make the totals sum to less than the row
// count, so the check refuses the matrix instead of quoting a smaller total.
test('a matrix row with an unknown status is invalid input', () => {
  const unknown = fixture(
    JSON.stringify({ capabilities: [{ id: 'content.decisions', core: true, native: 'unknown' }] }),
    'json',
  )
  const doc = fixture('- **1 core capabilities:** 0 native, 0 partial, 1 absent.\n')
  const result = run('--docs', doc, '--matrix', unknown)
  assert.equal(result.status, 2)
  assert.match(result.stderr, /not one of native, partial or absent/)
})

test('an unknown argument is invalid input', () => {
  const result = run('--nope')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unknown argument: --nope/)
})
