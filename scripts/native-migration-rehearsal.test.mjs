import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const script = path.resolve('scripts/native-migration-rehearsal.mjs')
const root = process.cwd()
const temp = mkdtempSync(path.join(tmpdir(), 'native-rehearsal-'))
after(() => rmSync(temp, { recursive: true, force: true }))

const env = { ...process.env }
delete env.NODE_TEST_CONTEXT

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
}

function file(name, contents) {
  const target = path.join(temp, name)
  writeFileSync(target, contents)
  return target
}

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: 'utf8' })
}

const original = [
  { _id: 'decision-1', tenantId: 'nuera', state: 'approved', revision: 3 },
  { _id: 'decision-2', tenantId: 'nuera', state: 'blocked', revision: 1 },
]

test('identical datasets are parity with exit 0', () => {
  const source = file('same-source.jsonl', jsonl(original))
  const target = file('same-target.jsonl', jsonl(original))
  const result = run(['compare', '--source', source, '--target', target])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /MIGRATION REHEARSAL PARITY OK: 2 records match/)
})

test('a changed field diverges with exit 1 and names the record', () => {
  const source = file('changed-source.jsonl', jsonl(original))
  const target = file('changed-target.jsonl', jsonl([original[0], { ...original[1], state: 'approved' }]))
  const result = run(['compare', '--source', source, '--target', target])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /MIGRATION REHEARSAL DIVERGED: 0 missing, 0 extra, 1 changed/)
  assert.match(result.stdout, /changed: decision-2/)
  assert.match(result.stdout, /This is not a pass/)
})

test('a missing record and an extra record are both reported', () => {
  const source = file('missing-source.jsonl', jsonl(original))
  const target = file('missing-target.jsonl', jsonl([original[0], { _id: 'decision-3', tenantId: 'nuera', state: 'proposed' }]))
  const result = run(['compare', '--source', source, '--target', target])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /1 missing, 1 extra, 0 changed/)
  assert.match(result.stdout, /missing: decision-2/)
  assert.match(result.stdout, /extra: decision-3/)
})

test('a duplicated _id is invalid input', () => {
  const source = file('dupe-source.jsonl', jsonl(original))
  const target = file('dupe-target.jsonl', jsonl([...original, original[0]]))
  const result = run(['compare', '--source', source, '--target', target])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /repeats _id decision-1/)
})

test('an empty dataset is invalid input, not a clean comparison', () => {
  const source = file('empty-source.jsonl', '')
  const target = file('empty-target.jsonl', jsonl(original))
  const result = run(['compare', '--source', source, '--target', target])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /dataset is empty/)
})

test('malformed JSONL is invalid input', () => {
  const source = file('broken-source.jsonl', '{"_id":"a",\n')
  const target = file('broken-target.jsonl', jsonl(original))
  const result = run(['compare', '--source', source, '--target', target])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /is not valid JSON/)
})

test('a snapshot verifies, detects tampering and never overwrites itself', () => {
  const source = file('snap-source.jsonl', jsonl(original))
  const out = path.join(temp, 'snapshot')
  const created = run(['snapshot', '--source', source, '--out', out])
  assert.equal(created.status, 0, created.stdout + created.stderr)
  assert.match(created.stdout, /snapshot: 2 records/)

  const verified = run(['verify', '--snapshot', out])
  assert.equal(verified.status, 0, verified.stdout + verified.stderr)
  assert.match(verified.stdout, /SNAPSHOT VERIFY OK/)

  const again = run(['snapshot', '--source', source, '--out', out])
  assert.equal(again.status, 2)
  assert.match(again.stderr, /refusing to overwrite an existing snapshot/)

  writeFileSync(path.join(out, 'records.jsonl'), jsonl([{ ...original[0], state: 'executed' }, original[1]]))
  const corrupt = run(['verify', '--snapshot', out])
  assert.equal(corrupt.status, 1)
  assert.match(corrupt.stdout, /SNAPSHOT VERIFY FAILED/)
})

test('restore writes the snapshot back and verifies the digest', () => {
  const source = file('restore-source.jsonl', jsonl(original))
  const out = path.join(temp, 'restore-snapshot')
  assert.equal(run(['snapshot', '--source', source, '--out', out]).status, 0)

  const target = path.join(temp, 'restored.jsonl')
  writeFileSync(target, jsonl([{ _id: 'decision-1', tenantId: 'nuera', state: 'tampered', revision: 9 }]))
  const restored = run(['restore', '--snapshot', out, '--target', target])
  assert.equal(restored.status, 0, restored.stdout + restored.stderr)
  assert.match(restored.stdout, /RESTORE OK: 2 records written/)

  const compared = run(['compare', '--source', source, '--target', target])
  assert.equal(compared.status, 0, compared.stdout + compared.stderr)
  assert.match(readFileSync(target, 'utf8'), /decision-2/)
})
