import assert from 'node:assert/strict'
import { test } from 'node:test'

import { auditDocuments, needsReview } from './exposure-audit.ts'

// Credential-shaped strings are assembled here so no literal that looks like a key is committed.
const fakeKey = ['sk', 'x'.repeat(30)].join('-')
const fakeBearer = ['Bearer', 'a'.repeat(32)].join(' ')
const email = ['jane.doe', 'example.org'].join('@')

const seedPolicy = { _id: 'policy-1', _type: 'policy', name: 'Operations Policy 17', body: 'Parameter changes need review.' }
const synthetic = [
  seedPolicy,
  { _id: 'entity-marcus-webb', _type: 'entity', name: 'Marcus Webb' },
  { _id: 'd1', _type: 'decision', _createdAt: '2026-09-25T10:00:00Z', question: 'Reduce downtime', requestedBy: 'entity-marcus-webb', approvedByName: 'Sarah Chen', candidateActions: [{ actor: { _ref: 'entity-marcus-webb' } }] },
  { _id: 'e1', _type: 'evaluationRecord', _createdAt: '2026-09-26T10:00:00Z', subject: 'Which policies apply?', requestedBy: 'entity-marcus-webb' },
  { _id: 'sys', _type: 'system.group' },
]

test('a synthetic dataset is counted by type, skips system documents, and is not flagged', () => {
  const report = auditDocuments(synthetic)
  assert.equal(report.documents, 4)
  assert.deepEqual(report.byType, { policy: 1, entity: 1, decision: 1, evaluationRecord: 1 })
  assert.deepEqual(report.findings, [])
  assert.equal(needsReview(report), false)
  assert.deepEqual(report.createdRange.find((r) => r.type === 'decision'), { type: 'decision', first: '2026-09-25T10:00:00Z', last: '2026-09-25T10:00:00Z' })
  assert.ok(report.freeText.some((f) => f.type === 'evaluationRecord' && f.path === 'subject'))
})

test('email addresses in a person field and in free text are found and the dataset needs review', () => {
  const report = auditDocuments([
    ...synthetic,
    { _id: 'd2', _type: 'decision', question: `Ask ${email} to approve`, requestedBy: email },
  ])
  assert.ok(report.findings.some((f) => f.kind === 'email' && f.type === 'decision' && f.path === 'question'))
  assert.ok(report.findings.some((f) => f.kind === 'email' && f.path === 'requestedBy'))
  assert.deepEqual(report.personFields.find((f) => f.path === 'requestedBy'), { path: 'requestedBy', distinct: 2, emailLike: 1 })
  assert.equal(needsReview(report), true)
})

test('credential-shaped strings and URLs carrying a secret are found, wherever they were typed', () => {
  const report = auditDocuments([
    { _id: 'e2', _type: 'evaluationRecord', subject: `use ${fakeKey} for the call` },
    { _id: 'e3', _type: 'evaluationRecord', notes: [{ text: `header ${fakeBearer}` }] },
    { _id: 'e4', _type: 'evaluationRecord', subject: 'see https://example.org/x?token=abcdef123456' },
  ])
  assert.equal(report.findings.filter((f) => f.kind === 'credential').length, 2)
  assert.ok(report.findings.some((f) => f.kind === 'credential' && f.path === 'notes[].text'), 'array indexes collapse in the path')
  assert.ok(report.findings.some((f) => f.kind === 'url-with-secret'))
  assert.equal(needsReview(report), true)
})

test('the report never contains a value it found, so it can be shared', () => {
  const text = JSON.stringify(auditDocuments([
    { _id: 'd3', _type: 'decision', question: `mail ${email}`, requestedBy: email, subject: fakeKey },
    { _id: 'e5', _type: 'evaluationRecord', subject: fakeBearer },
  ]))
  for (const secret of [email, fakeKey, fakeBearer, 'jane.doe']) assert.ok(!text.includes(secret), `report leaked ${secret.slice(0, 6)}`)
})

test('document ids, references and similar are not mistaken for personal data', () => {
  const report = auditDocuments([{ _id: 'entity-a@b.example', _type: 'entity', owner: { _ref: 'person@host.example', _key: 'k@x.example' } }])
  assert.deepEqual(report.findings, [])
})
