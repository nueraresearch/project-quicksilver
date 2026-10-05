import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { authorizationCheck, emailRecipientAllowed, runChecks, sendingDomainVerdict } from './resend-check.mjs'

// The preflight is the thing that decides whether a founder believes Resend is
// ready. A check that passes while the real adapter would refuse is worse than
// no check, so these tests hold it to the adapters' own rules.

const root = fileURLToPath(new URL('..', import.meta.url))
const fullEnv = {
  QUICKSILVER_EMAIL_API_KEY: 're_test_key',
  QUICKSILVER_EMAIL_FROM: 'quicksilver@nuera.example',
  QUICKSILVER_EMAIL_INBOUND_SECRET: 's'.repeat(40),
}
const fullPolicy = {
  enabledTools: ['notification.send'],
  email: { from: 'quicksilver@nuera.example', recipients: ['ops@nuera.example'], apiKeyEnv: 'QUICKSILVER_EMAIL_API_KEY' },
}
const config = (policy) => (name) => (name === 'policy.json' ? policy : undefined)
const names = (checks) => checks.filter((c) => !c.ok).map((c) => c.name)
const failed = (checks) => Object.fromEntries(checks.filter((c) => !c.ok).map((c) => [c.name, c.detail]))

test('a complete configuration passes every check', () => {
  const checks = runChecks({ ...fullEnv, QUICKSILVER_ACTIONS_CONFIG: 'policy.json' }, config(fullPolicy))
  assert.deepEqual(names(checks), [], `unexpected failures: ${JSON.stringify(failed(checks), null, 2)}`)
})

test('a missing API key is reported once, not once per path that wants it', () => {
  const env = { ...fullEnv, QUICKSILVER_ACTIONS_CONFIG: 'policy.json' }
  delete env.QUICKSILVER_EMAIL_API_KEY
  const checks = runChecks(env, config(fullPolicy))
  assert.deepEqual(names(checks), ['operator channel: QUICKSILVER_EMAIL_API_KEY is set'])
  assert.match(failed(checks)['operator channel: QUICKSILVER_EMAIL_API_KEY is set'], /API Keys/)
})

test('a short inbound secret is refused, because the adapter requires 32+', () => {
  const env = { ...fullEnv, QUICKSILVER_ACTIONS_CONFIG: 'policy.json', QUICKSILVER_EMAIL_INBOUND_SECRET: 'short' }
  assert.deepEqual(names(runChecks(env, config(fullPolicy))), ['QUICKSILVER_EMAIL_INBOUND_SECRET is 32+ characters'])
})

test('an unparseable policy file stops the run instead of half-passing it', () => {
  const env = { ...fullEnv, QUICKSILVER_ACTIONS_CONFIG: 'policy.json' }
  const checks = runChecks(env, () => undefined)
  assert.deepEqual(names(checks), ['policy.json is readable JSON'])
})

test('a policy whose apiKeyEnv names a different, unset variable is caught', () => {
  const env = { ...fullEnv, QUICKSILVER_ACTIONS_CONFIG: 'policy.json' }
  delete env.QUICKSILVER_EMAIL_API_KEY
  const policy = { ...fullPolicy, email: { ...fullPolicy.email, apiKeyEnv: 'SOME_OTHER_KEY' } }
  // Both paths are genuinely unmet: the operator channel still has no key, and
  // the policy points somewhere else that is also unset.
  assert.deepEqual(names(runChecks(env, config(policy))), ['operator channel: QUICKSILVER_EMAIL_API_KEY is set', 'policy: SOME_OTHER_KEY is set'])
})

test('notification.send missing from enabledTools is caught', () => {
  const env = { ...fullEnv, QUICKSILVER_ACTIONS_CONFIG: 'policy.json' }
  const policy = { ...fullPolicy, enabledTools: ['webhook.dispatch'] }
  assert.deepEqual(names(runChecks(env, config(policy))), ['enabledTools includes notification.send'])
})

test('an empty recipient list is caught, because it would allow no one', () => {
  const env = { ...fullEnv, QUICKSILVER_ACTIONS_CONFIG: 'policy.json' }
  const policy = { ...fullPolicy, email: { ...fullPolicy.email, recipients: [] } }
  assert.deepEqual(names(runChecks(env, config(policy))), ['policy email.recipients is a non-empty list'])
})

test('the recipient rule matches the host adapter, including whole domains', () => {
  // Cross-checked against packages/host/src/tool-adapters.ts emailRecipientAllowed.
  assert.equal(emailRecipientAllowed('ops@nuera.example', ['ops@nuera.example']), true)
  assert.equal(emailRecipientAllowed('OPS@Nuera.Example', ['ops@nuera.example']), true)
  assert.equal(emailRecipientAllowed('anyone@nuera.example', ['@nuera.example']), true)
  assert.equal(emailRecipientAllowed('someone@else.example', ['@nuera.example']), false)
  assert.equal(emailRecipientAllowed('a@nuera.example@evil.example', ['@nuera.example']), false)
  assert.equal(emailRecipientAllowed('not-an-address', ['@nuera.example']), false)
})

test('the shipped example policy survives its own preflight shape check', () => {
  // actions.example.json is the file a founder copies. If it stops parsing or
  // loses a required key, the preflight they run first will fail confusingly.
  const policy = JSON.parse(readFileSync(new URL('deploy/actions/actions.example.json', `file://${root}`), 'utf8'))
  assert.ok(Array.isArray(policy.enabledTools) && policy.enabledTools.includes('notification.send'))
  assert.equal(typeof policy.email?.apiKeyEnv, 'string')
  assert.ok(Array.isArray(policy.email?.recipients) && policy.email.recipients.length > 0)
})

test('an unset authorization key is reported, because nothing can be approved without it', () => {
  assert.equal(authorizationCheck({}, undefined).name, 'QUICKSILVER_AUTHORIZATION_KEY')
  assert.equal(authorizationCheck({}, undefined).ok, false)
  assert.equal(authorizationCheck({ QUICKSILVER_AUTHORIZATION_KEY: 'k' }, undefined).ok, true)
  assert.equal(authorizationCheck({}, { execution: { authorizationKeyEnv: 'OTHER_KEY' } }).name, 'OTHER_KEY')
})

test('no check ever prints the secret it is checking', () => {
  const secret = 'sk_do_not_leak_me'
  const env = { ...fullEnv, QUICKSILVER_EMAIL_API_KEY: secret, QUICKSILVER_ACTIONS_CONFIG: 'policy.json', QUICKSILVER_EMAIL_INBOUND_SECRET: 'x'.repeat(40) }
  const rendered = JSON.stringify(runChecks(env, config(fullPolicy)))
  assert.equal(rendered.includes(secret), false, 'the API key value must not appear in any check detail')
})

test('a from-address on a public mail provider is caught before a send costs a 403', () => {
  // Resend: "Resend sends emails using a domain you own (i.e. not a shared or
  // public domain)". A gmail from-address reads like a key problem and is not.
  for (const from of ['nuera.agtech@gmail.com', 'a@googlemail.com', 'b@outlook.com', 'c@hotmail.co.uk', 'd@yahoo.com', 'e@icloud.com', 'f@proton.me']) {
    assert.equal(sendingDomainVerdict(from).level, 'fail', `${from} should be refused`)
  }
  assert.match(sendingDomainVerdict('x@gmail.com').detail, /resend\.com\/domains/)
  // A domain you control is fine, including a subdomain of one — and `mail.*` is
  // exactly the subdomain Resend recommends verifying, so a naive prefix test
  // would refuse the configuration the docs tell you to use.
  assert.equal(sendingDomainVerdict('quicksilver@nueraresearch.com').level, 'ok')
  assert.equal(sendingDomainVerdict('ops@mail.nueraresearch.com').level, 'ok')
  assert.equal(sendingDomainVerdict('ops@send.nueraresearch.com').level, 'ok')
  assert.equal(sendingDomainVerdict('x@mail.com').level, 'fail', 'mail.com really is a provider')
  // The one legitimate use of a domain you do not own: the first test send.
  assert.equal(sendingDomainVerdict('onboarding@resend.dev').level, 'warn')
  assert.equal(sendingDomainVerdict('nope').level, 'fail')
})

test('a gmail from-address fails the preflight in both the env and the policy', () => {
  const env = { ...fullEnv, QUICKSILVER_EMAIL_FROM: 'nuera.agtech@gmail.com', QUICKSILVER_ACTIONS_CONFIG: 'policy.json' }
  const policy = { ...fullPolicy, email: { ...fullPolicy.email, from: 'nuera.agtech@gmail.com' } }
  const bad = names(runChecks(env, config(policy)))
  assert.deepEqual(bad, [
    'QUICKSILVER_EMAIL_FROM is a domain Resend can send from',
    'policy email.from is a domain Resend can send from',
  ])
  // Fixing only one of the two still fails, so the two are reported separately.
  const fixedPolicy = { ...fullPolicy, email: { ...fullPolicy.email, from: 'quicksilver@nueraresearch.com' } }
  assert.deepEqual(names(runChecks(env, config(fixedPolicy))), ['QUICKSILVER_EMAIL_FROM is a domain Resend can send from'])
})

test('run as a command, the script actually runs its checks and fails closed', () => {
  // The unit tests above import the module, so they pass even if the entrypoint
  // guard never fires. A hand-built file:// URL comparison does exactly that on
  // Windows (file:///C:/... vs file://C:/...), and the symptom is a preflight
  // that prints nothing and exits 0 — the worst kind of silent success.
  // So this spawns it. INIT_CWD points at an empty directory so the result does
  // not depend on whatever .env files happen to sit near the checkout.
  const empty = mkdtempSync(join(tmpdir(), 'qs-resend-check-'))
  const result = spawnSync(process.execPath, [new URL('resend-check.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], {
    encoding: 'utf8',
    env: { ...process.env, INIT_CWD: empty, QUICKSILVER_EMAIL_API_KEY: '', QUICKSILVER_EMAIL_FROM: '', QUICKSILVER_EMAIL_INBOUND_SECRET: '', QUICKSILVER_ACTIONS_CONFIG: '' },
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.match(output, /Resend preflight/, `the script printed nothing: ${JSON.stringify(output)}`)
  assert.match(output, /check\(s\) failed/, 'an unconfigured environment must fail the preflight, not pass it')
  assert.notEqual(result.status, 0, 'an unconfigured preflight must exit non-zero')
})
