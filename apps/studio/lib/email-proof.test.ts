import assert from 'node:assert/strict'
import test from 'node:test'
import { hasFailure } from './demo-preflight.ts'
import { checkAgentRefused, checkApprove, checkHealth, checkPropose, checkReplay } from './email-proof.ts'

test('health: ok passes, silence and errors fail', () => {
  assert.equal(hasFailure(checkHealth(200, { status: 'ok' })), false)
  assert.equal(hasFailure(checkHealth(0, {})), true)
  assert.equal(hasFailure(checkHealth(502, {})), true)
})

test('propose: needs 201, an id, and executed false', () => {
  const ok = checkPropose(201, { proposal: { id: 'act-1' }, executed: false })
  assert.equal(ok.id, 'act-1')
  assert.equal(hasFailure(ok.findings), false)
  assert.equal(hasFailure(checkPropose(201, { proposal: { id: 'act-1' }, executed: true }).findings), true)
  assert.equal(hasFailure(checkPropose(201, {}).findings), true)
  assert.equal(hasFailure(checkPropose(401, {}).findings), true)
  assert.equal(hasFailure(checkPropose(400, { error: 'recipient not allowed' }).findings), true)
})

test('an agent approving must be refused with 403', () => {
  assert.equal(hasFailure(checkAgentRefused(403)), false)
  assert.equal(hasFailure(checkAgentRefused(200)), true)
})

test('approve: live execution passes, dry run and failures do not', () => {
  assert.equal(hasFailure(checkApprove(200, { proposal: { status: 'executed' }, executed: true, dryRun: false })), false)
  assert.equal(hasFailure(checkApprove(200, { proposal: { status: 'executed' }, executed: true, dryRun: true })), true)
  assert.equal(hasFailure(checkApprove(200, { proposal: { status: 'failed' }, executed: false })), true)
  assert.equal(hasFailure(checkApprove(503, {})), true)
  assert.equal(hasFailure(checkApprove(403, { error: 'proposer cannot approve' })), true)
})

test('replay must be refused with 409', () => {
  assert.equal(hasFailure(checkReplay(409)), false)
  assert.equal(hasFailure(checkReplay(200)), true)
})
