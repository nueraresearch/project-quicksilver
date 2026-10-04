import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEMO_OBJECTIVES, validateDemoObjectives } from '../seed/demo-objectives.ts'
import { assertSafeBaseUrl, isWaitingForApproval, plannedDecisions } from './demo-decisions.ts'

test('the demo objectives are valid', () => {
  assert.deepEqual(validateDemoObjectives(), [])
  assert.ok(DEMO_OBJECTIVES.length >= 3)
})

test('validation names duplicate ids, short objectives and missing purpose', () => {
  const problems = validateDemoObjectives([
    { id: 'a-b-c', objective: 'long enough objective', shows: 'x' },
    { id: 'a-b-c', objective: 'no', shows: ' ' },
  ])
  assert.ok(problems.some((p) => p.includes('duplicate')))
  assert.ok(problems.some((p) => p.includes('3 to 2,000')))
  assert.ok(problems.some((p) => p.includes('meant to show')))
})

test('the base URL must be https, or http on this machine, with no credentials, query or fragment', () => {
  assert.equal(assertSafeBaseUrl('https://demo.example.com').hostname, 'demo.example.com')
  assert.equal(assertSafeBaseUrl('http://localhost:3000').port, '3000')
  assert.throws(() => assertSafeBaseUrl('http://demo.example.com'), /https/)
  assert.throws(() => assertSafeBaseUrl('https://user:pw@demo.example.com'), /credentials/)
  assert.throws(() => assertSafeBaseUrl('https://demo.example.com/?a=1'), /query/)
  assert.throws(() => assertSafeBaseUrl('https://demo.example.com/#x'), /query/)
  assert.throws(() => assertSafeBaseUrl('not a url'), /full URL/)
})

test('plannedDecisions keeps only saved decisions and tolerates odd shapes', () => {
  const rows = plannedDecisions({ decisions: [
    { decisionDocId: 'd1', status: 'awaiting-approval', safetyDecision: 'ALLOW', action: { description: 'Do it' } },
    { status: 'awaiting-approval' },
    { decisionDocId: 'd2' },
  ] })
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { decisionDocId: 'd1', action: 'Do it', safetyDecision: 'ALLOW', status: 'awaiting-approval' })
  assert.equal(rows[1]!.action, '(no description)')
  assert.deepEqual(plannedDecisions(null), [])
  assert.deepEqual(plannedDecisions({ decisions: 'x' }), [])
})

test('only proposed or awaiting-approval decisions count as waiting', () => {
  const base = { decisionDocId: 'd', action: 'a', safetyDecision: null }
  assert.equal(isWaitingForApproval({ ...base, status: 'awaiting-approval' }), true)
  assert.equal(isWaitingForApproval({ ...base, status: 'refused' }), false)
  assert.equal(isWaitingForApproval({ ...base, status: null }), false)
})
