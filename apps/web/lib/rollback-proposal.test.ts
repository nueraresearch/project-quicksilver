/**
 * POST /api/decisions/{id}/rollback with the process engine off must not create another rollback decision
 * while one for the same decision is still pending.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./route-test-loader.mjs', import.meta.url)
const { proposeLegacyRollback } = await import('./rollback-proposal.ts')

type Doc = Record<string, any>
function fakeClient(existing: Doc[] = []) {
  const docs: Doc[] = [...existing]
  return {
    docs,
    fetch: async (query: string, params: Record<string, unknown>) => {
      assert.match(query, /rollbackOf\._ref == \$id/)
      return docs
        .filter((d) => d.rollbackOf?._ref === params.id && ['proposed', 'awaiting-approval', 'approved'].includes(d.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ _id, status }) => ({ _id, status }))
        .slice(0, 1)
    },
    create: async (doc: Doc) => { docs.push(doc); return doc },
  }
}
const original = { _id: 'decision-1', selectedAction: 'Raise price', policyChecks: [], policySnapshotVersion: 'v1' }

test('the first legacy rollback proposal creates a decision that points at its parent', async () => {
  const client = fakeClient()
  const result = await proposeLegacyRollback(client as never, original, undefined, 1000)
  assert.equal(result.alreadyProposed, false)
  assert.equal(client.docs.length, 1)
  assert.equal(client.docs[0]!.rollbackOf._ref, 'decision-1')
  assert.equal(client.docs[0]!.status, 'awaiting-approval')
  assert.equal(result.rollbackDecisionId, client.docs[0]!._id)
})

test('a repeat while the rollback is pending returns the existing decision and creates nothing', async () => {
  const client = fakeClient()
  const first = await proposeLegacyRollback(client as never, original, undefined, 1000)
  const second = await proposeLegacyRollback(client as never, original, undefined, 2000)
  assert.equal(second.alreadyProposed, true)
  assert.equal(second.rollbackDecisionId, first.rollbackDecisionId)
  assert.equal(client.docs.length, 1)
})

test('once the earlier rollback is finished a new one may be proposed', async () => {
  const client = fakeClient()
  const first = await proposeLegacyRollback(client as never, original, undefined, 1000)
  client.docs[0]!.status = 'rejected'
  const second = await proposeLegacyRollback(client as never, original, undefined, 2000)
  assert.equal(second.alreadyProposed, false)
  assert.notEqual(second.rollbackDecisionId, first.rollbackDecisionId)
  assert.equal(client.docs.length, 2)
})
