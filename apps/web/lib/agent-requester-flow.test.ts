import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { checkSeparationOfDuties } from '../../../packages/kernel/src/identity/separation.ts'
import { digestToken } from '../../../packages/kernel/src/identity/tokens.ts'
import { checkSupervisorCredential } from './nqc-approval.ts'
import { checkWebRoute, resetWebRateLimits } from './route-guard.ts'

// The judge access on the production app: an agent entity asks for plans, and a human token approves them.
// Tokens are built here at run time; nothing in this file is a credential.
const token = (name: string) => `qs_${name}_${'x'.repeat(40)}`
const agentToken = token('agent')
const judgeToken = token('judge')
const judgeNoPlanToken = token('approveonly')

const principals = JSON.stringify([
  { id: 'entity-engineering-agent', kind: 'agent', tenantId: 'nuera', roles: ['agent-worker'], tokenDigest: digestToken(agentToken) },
  { id: 'entity-sarah-chen', kind: 'human', tenantId: 'nuera', roles: ['supervisor', 'developer'], tokenDigest: digestToken(judgeToken) },
  { id: 'entity-diego-ruiz', kind: 'human', tenantId: 'nuera', roles: ['supervisor'], tokenDigest: digestToken(judgeNoPlanToken) },
])
const env = { QUICKSILVER_TENANT_ID: 'nuera', QUICKSILVER_PRINCIPALS: principals }
const bearer = (value: string) => `Bearer ${value}`

beforeEach(() => resetWebRateLimits())

test('an agent entity can ask for a plan, and the decision would record it as the requester', () => {
  const result = checkWebRoute('plan', bearer(agentToken), env)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.principalId, 'entity-engineering-agent')
})

test('an agent entity can never approve or execute, however it asks', () => {
  const approve = checkSupervisorCredential(bearer(agentToken), 'decision:approve', env)
  assert.equal(approve.ok, false)
  assert.equal(approve.ok ? 0 : approve.status, 403)
  const execute = checkSupervisorCredential(bearer(agentToken), 'decision:execute', env)
  assert.equal(execute.ok, false)
})

test('the judge token approves, reads decisions and the audit trail, and asks the chat', () => {
  const approve = checkSupervisorCredential(bearer(judgeToken), 'decision:approve', env)
  assert.equal(approve.ok, true)
  if (approve.ok) assert.equal(approve.supervisorId, 'entity-sarah-chen')
  for (const route of ['decisions', 'decisions/detail', 'decisions/audit', 'chat', 'inbox'] as const) {
    assert.equal(checkWebRoute(route, bearer(judgeToken), env).ok, true, route)
  }
})

test('an approve-only token cannot ask for a plan; the guard names what is missing', () => {
  const plan = checkWebRoute('plan', bearer(judgeNoPlanToken), env)
  assert.equal(plan.ok, false)
  if (!plan.ok) {
    assert.equal(plan.status, 403)
    assert.deepEqual(plan.body.needs, ['decision:propose'])
  }
})

test('a wrong or missing token is refused', () => {
  assert.equal(checkWebRoute('plan', bearer(token('guess')), env).ok, false)
  assert.equal(checkWebRoute('plan', null, env).ok, false)
  assert.equal(checkSupervisorCredential(bearer(token('guess')), 'decision:approve', env).ok, false)
})

test('the judge approves what the agent asked for, but never what the judge asked for', () => {
  const planner = 'nuera-quicksilver:planner'
  const askedByAgent = checkSeparationOfDuties({ approverId: 'entity-sarah-chen', requestedBy: 'entity-engineering-agent', proposedBy: planner })
  assert.equal(askedByAgent.allowed, true)
  const askedByJudge = checkSeparationOfDuties({ approverId: 'entity-sarah-chen', requestedBy: 'entity-sarah-chen', proposedBy: planner })
  assert.equal(askedByJudge.allowed, false)
  assert.match(askedByJudge.conflicts.join(' '), /requested/)
})

test('a token for another tenant is refused', () => {
  const other = { ...env, QUICKSILVER_TENANT_ID: 'other' }
  assert.equal(checkWebRoute('plan', bearer(agentToken), other).ok, false)
})
