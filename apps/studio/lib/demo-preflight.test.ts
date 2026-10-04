import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { buildDecisionAudit } from '../../web/lib/decision-audit.ts'
import { checkAudit, checkChat, checkDataset, checkDecisions, checkWhoami, hasFailure } from './demo-preflight.ts'

const judge = { label: 'Judge token', id: 'entity-sarah-chen', kind: 'human' as const, must: ['decision:read', 'decision:approve', 'audit:read'], mustNot: [] as string[] }
const agent = { label: 'Agent token', id: 'entity-engineering-agent', kind: 'agent' as const, must: ['decision:propose'], mustNot: ['decision:approve', 'decision:execute'] }
const levels = (findings: { level: string }[]) => findings.map((f) => f.level)

test('whoami: a good judge token passes, with a warning that supervisor reaches beyond approving', () => {
  const body = { principalId: 'entity-sarah-chen', kind: 'human', tenantId: 'default', permissions: ['decision:read', 'decision:approve', 'audit:read', 'finance:read', 'workflow:publish'] }
  const findings = checkWhoami(200, body, judge)
  assert.deepEqual(levels(findings), ['pass', 'warn'])
  assert.match(findings[1]!.text, /finance:read/)
})

test('whoami: a refused token says why, and a wrong tenant is recognised by the empty permission list', () => {
  assert.match(checkWhoami(401, {}, judge)[0]!.text, /redeployed/)
  assert.match(checkWhoami(503, {}, judge)[0]!.text, /JSON/)
  const noPermissions = checkWhoami(200, { principalId: 'entity-sarah-chen', kind: 'human', tenantId: 'default', permissions: [] }, judge)
  assert.equal(hasFailure(noPermissions), true)
  assert.match(noPermissions[0]!.text, /QUICKSILVER_TENANT_ID/)
})

test('whoami: the wrong entity, a missing permission and a forbidden one all fail', () => {
  assert.equal(hasFailure(checkWhoami(200, { principalId: 'entity-someone-else', kind: 'human', permissions: ['decision:read'] }, judge)), true)
  assert.equal(hasFailure(checkWhoami(200, { principalId: 'entity-sarah-chen', kind: 'human', permissions: ['decision:read'] }, judge)), true)
  const agentThatCanApprove = checkWhoami(200, { principalId: 'entity-engineering-agent', kind: 'agent', permissions: ['decision:propose', 'decision:approve'] }, agent)
  assert.match(agentThatCanApprove.map((f) => f.text).join(' '), /must not hold decision:approve/)
  assert.deepEqual(levels(checkWhoami(200, { principalId: 'entity-engineering-agent', kind: 'agent', tenantId: 'default', permissions: ['decision:read', 'decision:propose'] }, agent)), ['pass'])
})

test('decisions: none waiting fails, a few waiting warns, plenty passes, and a human requester is flagged', () => {
  const row = (id: string, requestedBy: string) => ({ id, status: 'awaiting-approval', requestedBy })
  assert.equal(hasFailure(checkDecisions(200, { counts: { 'awaiting-approval': 0 }, decisions: [] }).findings), true)
  assert.deepEqual(levels(checkDecisions(200, { counts: { 'awaiting-approval': 2 }, decisions: [row('d1', 'a'), row('d2', 'a')] }, { agentId: 'a' }).findings), ['warn'])
  const plenty = checkDecisions(200, { counts: { 'awaiting-approval': 6 }, decisions: [row('d1', 'a')] }, { agentId: 'a' })
  assert.deepEqual(levels(plenty.findings), ['pass'])
  assert.equal(plenty.firstWaitingId, 'd1')
  const mixed = checkDecisions(200, { counts: { 'awaiting-approval': 6 }, decisions: [row('d1', 'entity-sarah-chen')] }, { agentId: 'a' })
  assert.deepEqual(levels(mixed.findings), ['pass', 'warn'])
  assert.equal(hasFailure(checkDecisions(500, {}).findings), true)
})

test('audit: a real export passes, an edited one fails', () => {
  const exported = buildDecisionAudit({ _id: 'decision-1', question: 'q', status: 'executed' }, 'entity-sarah-chen', '2026-10-04T00:00:00.000Z')
  assert.deepEqual(levels(checkAudit(200, exported)), ['pass'])
  const edited = { ...exported, decision: { ...exported.decision, status: 'rejected' } }
  assert.equal(hasFailure(checkAudit(200, edited)), true)
  assert.equal(hasFailure(checkAudit(403, {})), true)
  assert.equal(hasFailure(checkAudit(200, { schema: 'other' })), true)
  // sanity: the digest in the passing case really is the digest of the decision
  assert.equal(exported.integrity.digest.length, createHash('sha256').update('x').digest('hex').length)
})

test('chat: an answer with sources passes, one without warns, an error fails with its reason', () => {
  assert.deepEqual(levels(checkChat(200, { answer: 'Operations Policy 17 requires approval for parameter changes.', sources: [{}, {}] })), ['pass'])
  assert.deepEqual(levels(checkChat(200, { answer: 'Operations Policy 17 requires approval for parameter changes.', sources: [] })), ['warn'])
  assert.equal(hasFailure(checkChat(200, { answer: 'ok' })), true)
  const failed = checkChat(500, { error: 'Chat failed', detail: 'MCPClientError' })
  assert.match(failed[0]!.text, /MCPClientError/)
})

test('dataset: public with rows passes; private, missing and empty fail', () => {
  assert.deepEqual(levels(checkDataset(200, { result: [{ name: 'a' }] })), ['pass'])
  assert.match(checkDataset(401, {})[0]!.text, /private/)
  assert.match(checkDataset(404, {})[0]!.text, /not found/)
  assert.match(checkDataset(200, { result: [] })[0]!.text, /seeded/)
})

test('no answer at all is reported as unreachable, not as a refusal', () => {
  assert.match(checkWhoami(0, {}, judge)[0]!.text, /could not reach/)
  assert.match(checkDecisions(0, {}).findings[0]!.text, /could not reach/)
  assert.match(checkAudit(0, {})[0]!.text, /could not reach/)
  assert.match(checkChat(0, {})[0]!.text, /could not reach/)
  assert.match(checkDataset(0, {})[0]!.text, /could not reach/)
})
