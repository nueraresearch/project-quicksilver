import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runDailyAttentionRoutine,
  runStaleLoopAuditRoutine,
  runCheckBackFollowupRoutine,
} from './routines.ts'

test('Operator routines: runs daily attention review routine', () => {
  const result = runDailyAttentionRoutine({
    now: Date.parse('2026-10-12T08:00:00Z'),
    decisions: [{ _id: 'd-1', question: 'Review budget', status: 'awaiting-approval', riskLevel: 2 }],
    commitments: [{ _id: 'c-1', title: 'Call contractor', direction: 'i-owe', dueAt: '2026-10-12T07:00:00Z' }],
  })

  assert.equal(result.kind, 'daily-attention')
  assert.equal(result.review?.metrics.pendingDecisionsCount, 1)
  assert.equal(result.review?.metrics.dueCommitmentsCount, 1)
})

test('Operator routines: runs stale loops audit and check-back follow-up routine', () => {
  const now = Date.parse('2026-10-12T12:00:00Z')
  const commitments = [
    { _id: 'c-old', title: 'Old query', status: 'open', createdAt: '2026-09-01T00:00:00Z' },
    { _id: 'c-check', title: 'Check on redline', status: 'open', direction: 'they-owe', checkBackAt: '2026-10-10T00:00:00Z' },
  ]

  const staleResult = runStaleLoopAuditRoutine({ now, commitments })
  assert.equal(staleResult.kind, 'stale-audit')
  assert.ok(staleResult.staleCount! >= 1)

  const checkbackResult = runCheckBackFollowupRoutine({ now, commitments })
  assert.equal(checkbackResult.kind, 'check-back-sync')
  assert.equal(checkbackResult.dueCheckbacksCount, 1)
})
