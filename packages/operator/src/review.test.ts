import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleReview, formatReviewPlainText } from './review.ts'

test('Review engine: assembles daily attention review with metrics and highlights', () => {
  const now = Date.parse('2026-10-12T08:00:00Z')
  const review = assembleReview({
    cadence: 'daily',
    now,
    decisions: [
      { _id: 'd-1', question: 'Approve vendor contract', status: 'awaiting-approval', riskLevel: 3 },
      { _id: 'd-2', question: 'Deploy routine', status: 'executed', riskLevel: 1 },
    ],
    commitments: [
      { _id: 'c-1', title: 'Prepare board slides', direction: 'i-owe', dueAt: '2026-10-12T07:00:00Z', counterpartyName: 'CEO' },
      { _id: 'c-2', title: 'Security review feedback', direction: 'they-owe', checkBackAt: '2026-10-11T12:00:00Z', counterpartyName: 'Infosec' },
      { _id: 'c-3', title: 'Quarterly tax filing', direction: 'i-owe', dueAt: '2026-10-16T12:00:00Z' },
    ],
  })

  assert.equal(review.cadence, 'daily')
  assert.equal(review.metrics.pendingDecisionsCount, 1)
  assert.equal(review.metrics.dueCommitmentsCount, 1)
  assert.equal(review.metrics.waitingOnOthersCount, 1)
  assert.equal(review.metrics.upcomingCount, 1)
  assert.ok(review.highlights.length >= 3)
  assert.match(review.summary, /Daily Attention Review/)

  const text = formatReviewPlainText(review)
  assert.match(text, /Pending Decisions:/)
  assert.match(text, /Actions Due:/)
  assert.match(text, /Waiting on Counterparties:/)
  assert.match(text, /Prepare board slides/)
})

test('Review engine: clean slate produces clear highlights', () => {
  const review = assembleReview({
    cadence: 'weekly',
    decisions: [],
    commitments: [],
  })

  assert.equal(review.metrics.pendingDecisionsCount, 0)
  assert.equal(review.metrics.dueCommitmentsCount, 0)
  assert.equal(review.highlights[0], 'All operational commitments and approval queues are clear.')
})
