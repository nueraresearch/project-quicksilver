import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

import { bodyDigest } from './adr-digest.mjs'

/**
 * The architecture decision series is append-only (ADR 0001, "Status and
 * amendment"). These checks cover the mechanics that make numbering a memory
 * system rather than a filing habit: contiguous numbers, the header fields the
 * amendment rule depends on, supersession recorded on both records, and an
 * index entry so a record can be found.
 *
 * They deliberately do not judge the prose. Whether a decision is right is
 * review's job; whether it is lost is this file's job. The body digest is the
 * one rule that constrains prose, and it constrains nothing but that: it proves
 * the text is the text that was accepted, never that the text is good.
 */
const directory = new URL('../docs/platform/', import.meta.url)
const index = readFileSync(new URL('./README.md', directory), 'utf8')
const names = readdirSync(directory)
  .filter((name) => /^adr-\d{4}-[a-z0-9-]+\.md$/.test(name))
  .sort()

function field(text, label) {
  return new RegExp(`^- \\*\\*${label}:\\*\\*[ \\t]*(.*)$`, 'm').exec(text)?.[1]?.trim()
}

const records = names.map((name) => {
  const text = readFileSync(new URL(name, directory), 'utf8')
  return {
    name,
    id: `ADR-${name.slice(4, 8)}`,
    status: field(text, 'Status'),
    date: field(text, 'Date'),
    deciders: field(text, 'Deciders'),
    supersedes: field(text, 'Supersedes'),
    supersededBy: field(text, 'Superseded by'),
    digest: field(text, 'Body digest'),
    text,
  }
})

// Prevents: two records sharing a number, or a gap that makes "the next free
// number" ambiguous — the decay that turns a decision log into a folder.
test('the ADR series is numbered contiguously from 0001', () => {
  assert.ok(names.length > 0, 'at least one architecture decision record exists')
  assert.deepEqual(
    names.map((name) => Number(name.slice(4, 8))),
    names.map((_, position) => position + 1),
    'ADR numbers must run 1, 2, 3, ... with no gap and no reuse',
  )
})

// Prevents: a record whose successor or status is unstated, so nobody can tell
// whether it still governs — the failure the amendment rule exists to stop.
test('every ADR declares the fields the amendment rule depends on', () => {
  for (const record of records) {
    assert.ok(record.status, `${record.name}: missing Status`)
    assert.match(record.status, /^(Proposed|Accepted|Superseded|Rejected)$/, `${record.name}: unknown Status "${record.status}"`)
    assert.match(record.date ?? '', /^\d{4}-\d{2}-\d{2}$/, `${record.name}: Date must be YYYY-MM-DD`)
    assert.ok(record.deciders, `${record.name}: missing Deciders`)
    assert.ok(record.supersedes, `${record.name}: missing Supersedes (write "none" when it replaces nothing)`)
    assert.ok(record.supersededBy, `${record.name}: missing Superseded by (write "none" when nothing replaces it)`)
    if (record.status === 'Superseded') {
      assert.match(record.supersededBy, /ADR-\d{4}/, `${record.name}: a superseded record must name its successor`)
    } else {
      assert.equal(record.supersededBy, 'none', `${record.name}: only a superseded record names a successor`)
    }
  }
})

// Prevents: a replacement recorded on one side only, and a dangling reference to
// a decision that was never written, so the chain cannot be walked either way.
test('supersession is recorded on both records and resolves', () => {
  const byId = new Map(records.map((record) => [record.id, record]))
  for (const record of records) {
    if (record.supersedes === 'none') continue
    for (const id of record.supersedes.match(/ADR-\d{4}/g) ?? []) {
      const replaced = byId.get(id)
      assert.ok(replaced, `${record.name}: supersedes ${id}, which does not exist`)
      assert.match(replaced.supersededBy, new RegExp(record.id), `${replaced.name}: does not point back at ${record.id}`)
      assert.equal(replaced.status, 'Superseded', `${replaced.name}: must be Superseded when ${record.id} supersedes it`)
    }
  }
})

// Prevents: a decision that exists but cannot be found, which is indistinguishable
// from a decision that was never made when someone goes looking for it.
// Prevents: an accepted record that can be reworded later with nothing to
// compare against, so nobody can tell a correction from a quiet reversal.
test('every record in force is sealed', () => {
  for (const record of records) {
    if (record.status === 'Proposed') continue
    assert.match(
      record.digest ?? '',
      /^sha256:[0-9a-f]{64}$/,
      `${record.name}: add "- **Body digest:** …" by running npm run adr:seal`,
    )
  }
})

// Prevents: the digest rotting into a stale string nobody checks, which would be
// worse than no digest — it would certify a body that is no longer the one sealed.
test('the body digest matches the record', () => {
  for (const record of records) {
    if (!record.digest) continue
    assert.equal(
      record.digest,
      bodyDigest(record.text),
      `${record.name}: the body changed after it was sealed. For a correction (typo, link, stale path) run npm run adr:seal and keep the digest change in the diff; a change to the decision itself needs a superseding ADR, not a reseal.`,
    )
  }
})

test('every ADR is reachable from the platform index', () => {
  const orphans = records.filter((record) => !index.includes(`(${record.name})`)).map((record) => record.name)
  assert.deepEqual(orphans, [], 'link every ADR from docs/platform/README.md so it can be found')
})
