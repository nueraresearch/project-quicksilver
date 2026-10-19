import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Duplex } from 'node:stream'

import { signWebhook } from '@quicksilver/kernel/triggers'
import { issueExecutionAuthorization, type ExecutionAuthorizationRecord } from '@quicksilver/kernel/runtime'
import { KernelQcsClient } from '@quicksilver/kernel/comms/qcs-client'
import { DummyAdapter, QcsImpl, intentFingerprint, type AgentIdentity, type QcsContext, type QcsIntent, type SendMessageRequest } from '@quicksilver/qcs'

import { ActionService, MemoryActionStore } from './actions.ts'
import { KernelQcsAuthority } from './qcs.ts'
import { emailNotificationToolFromConfig, emailRecipientAllowed, isPrivateAddress, smtpNotificationTool, resendNotificationTool, signedWebhookTool, localOutboxNotificationTool, localFileMutationTool, type HttpFetch } from './tool-adapters.ts'
import { dryRunTools, EffectfulToolExecutor, type ToolCall } from './tool-executor.ts'

// No network: every call goes to a fake that records what it was asked.

interface Sent { url: string; headers: Record<string, string>; body: string; redirect: string }
function fakeHttp(answer: { status?: number; body?: string } | Error = {}) {
  const sent: Sent[] = []
  const fetcher: HttpFetch = async (url, init) => {
    sent.push({ url, headers: init.headers, body: init.body, redirect: init.redirect })
    if (answer instanceof Error) throw answer
    return { status: answer.status ?? 200, text: async () => answer.body ?? '{}' }
  }
  return { fetcher, sent }
}

const API_KEY = 're_' + 'k'.repeat(24)
const SECRET = 'webhook-signing-secret-0123456789abcdef'
const call = (toolId: string, input: unknown): ToolCall => ({ toolId, input, tenantId: 'acme', runId: 'ap-1', nodeId: 'action', idempotencyKey: 'ap-1' })

// ── Email ─────────────────────────────────────────────────────────────────

test('SMTP: native TLS submission needs no mail API and refuses unsafe input before connecting', async () => {
  const writes: string[] = []
  let connections = 0
  const tool = smtpNotificationTool({
    host: 'smtp.example.com', username: 'quicksilver@example.com', password: API_KEY,
    from: 'quicksilver@example.com', recipients: ['ops@example.com'],
    connector: (options) => {
      connections++
      assert.deepEqual(options, { host: 'smtp.example.com', port: 465, servername: 'smtp.example.com', rejectUnauthorized: true })
      const socket = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          const line = chunk.toString()
          writes.push(line)
          if (line.startsWith('EHLO')) this.push('250-smtp.example.com\r\n250 AUTH PLAIN LOGIN\r\n')
          else if (line.startsWith('AUTH')) this.push('235 authenticated\r\n')
          else if (line.startsWith('DATA')) this.push('354 send message\r\n')
          else if (!line.startsWith('QUIT')) this.push('250 accepted\r\n')
          callback()
        },
      })
      queueMicrotask(() => { socket.emit('secureConnect'); socket.push('220 ready\r\n') })
      return socket
    },
  })
  for (const input of [
    { to: 'spy@example.com', subject: 's', text: 't' },
    { to: 'ops@example.com', subject: 's\r\nBcc: spy@example.com', text: 't' },
  ]) await assert.rejects(tool.run(call('notification.send', input)))
  assert.equal(connections, 0)
  const key = { keyId: 'acme:host-1', secret: '0123456789abcdef0123456789abcdef' }
  const service = new ActionService({ tenantId: 'acme', store: new MemoryActionStore('acme'), executor: new EffectfulToolExecutor({ tools: [tool], signingKey: key }), policy: { enabledTools: ['notification.send'] }, signingKey: key })
  const proposed = await service.propose({ id: 'agent', kind: 'agent' }, { toolId: 'notification.send', input: { to: 'ops@example.com', subject: 'Report ready', text: 'Hello\n.\nWorld' }, reason: 'Tell ops.', evidence: ['report:1'] })
  assert.ok(proposed.ok)
  assert.equal(connections, 0, 'proposing cannot send mail')
  const approved = await service.approve(proposed.proposal.id, { id: 'human' })
  assert.ok(approved.ok)
  assert.equal(approved.proposal.status, 'executed')
  assert.equal(connections, 1)
  assert.equal(tool.manifest.provider, 'smtp')
  assert.ok(approved.proposal.result!.outputDigest)
  assert.ok(!JSON.stringify(approved.proposal).includes(API_KEY))
  assert.ok(writes.some((line) => line.includes('Message-ID: <') && line.includes(Buffer.from('Hello\n.\nWorld').toString('base64'))))
  assert.equal((await service.approve(proposed.proposal.id, { id: 'human' })).ok, false)
  assert.equal(connections, 1, 'repeated approval cannot send twice')
  assert.throws(() => smtpNotificationTool({ host: 'smtp.example.com', username: 'user', password: '', from: 'qs@example.com', recipients: ['ops@example.com'] }), /username and password/)
})

test('SMTP: configuration selects native delivery explicitly and refuses missing credentials or unknown providers', () => {
  const config = { provider: 'smtp', from: 'qs@example.com', recipients: ['ops@example.com'], smtp: { host: 'smtp.example.com', port: 465 } }
  const env = { QUICKSILVER_SMTP_USERNAME: 'user', QUICKSILVER_SMTP_PASSWORD: API_KEY }
  const tool = emailNotificationToolFromConfig(config, env)
  assert.equal(tool.manifest.provider, 'smtp')
  assert.equal(tool.manifest.requiresApproval, true)
  assert.throws(() => emailNotificationToolFromConfig(config, {}), /username and password/)
  assert.throws(() => emailNotificationToolFromConfig({ ...config, provider: 'typo' }, env), /Unknown email provider/)
  assert.throws(() => emailNotificationToolFromConfig({ ...config, smtp: { host: 'smtp.example.com', port: '465' } }, env), /numeric TLS port/)
  assert.notEqual(tool.configDigest, emailNotificationToolFromConfig({ ...config, smtp: { host: 'other.example.com' } }, env).configDigest)
  assert.equal(emailNotificationToolFromConfig({ from: 'qs@example.com', recipients: ['ops@example.com'] }, { QUICKSILVER_EMAIL_API_KEY: API_KEY }).manifest.provider, 'resend')
})

test('SMTP: authentication refusal leaks no secret and never submits a message', async () => {
  const writes: string[] = []
  const tool = smtpNotificationTool({
    host: 'smtp.example.com', username: 'user', password: API_KEY, from: 'qs@example.com', recipients: ['ops@example.com'],
    connector: () => {
      const socket = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          writes.push(chunk.toString())
          this.push(chunk.toString().startsWith('EHLO') ? '250 AUTH PLAIN\r\n' : `535 rejected ${API_KEY}\r\n`)
          callback()
        },
      })
      queueMicrotask(() => { socket.emit('secureConnect'); socket.push('220 ready\r\n') })
      return socket
    },
  })
  await assert.rejects(tool.run(call('notification.send', { to: 'ops@example.com', subject: 's', text: 't' })), (error: Error) => /SMTP submission failed/.test(error.message) && !error.message.includes(API_KEY))
  assert.equal(writes.some((line) => line.startsWith('MAIL FROM')), false)
})

test('SMTP: TLS failures, early closes, missing authentication and malformed replies fail closed', async () => {
  for (const failure of ['tls', 'close', 'auth', 'multiline', 'oversized', 'recipient', 'data']) {
    const writes: string[] = []
    const tool = smtpNotificationTool({
      host: 'smtp.example.com', username: 'user', password: API_KEY, from: 'qs@example.com', recipients: ['ops@example.com'],
      connector: () => {
        const socket = new Duplex({
          read() {},
          write(chunk, _encoding, callback) {
            const line = chunk.toString()
            writes.push(line)
            if (line.startsWith('EHLO')) {
              this.push(failure === 'auth' ? '250 no authentication\r\n' : failure === 'multiline' ? '250-first\r\n550 wrong code\r\n' : failure === 'oversized' ? '250 ' + 'x'.repeat(65536) + '\r\n' : '250 AUTH PLAIN\r\n')
            } else if (line.startsWith('AUTH')) this.push('235 authenticated\r\n')
            else if (line.startsWith('RCPT') && failure === 'recipient') this.push('550 refused\r\n')
            else if (line.startsWith('DATA')) this.push('354 send message\r\n')
            else if (line.startsWith('From:')) this.push('554 refused\r\n')
            else this.push('250 accepted\r\n')
            callback()
          },
        })
        queueMicrotask(() => {
          if (failure === 'tls') socket.destroy(new Error(`Certificate invalid ${API_KEY}`))
          else if (failure === 'close') socket.destroy()
          else { socket.emit('secureConnect'); socket.push('220 ready\r\n') }
        })
        return socket
      },
    })
    await assert.rejects(tool.run(call('notification.send', { to: 'ops@example.com', subject: 's', text: 't' })), (error: Error) => /SMTP submission failed/.test(error.message) && !error.message.includes(API_KEY), failure)
    if (failure !== 'data') assert.equal(writes.some((line) => line.startsWith('From:')), false, failure)
  }
})

test('QCS: kernel client reaches dummy transport only with exact, human-bound kernel grants', async () => {
  const key = { keyId: 'acme:qcs', secret: SECRET }
  const principal = { tenant_id: 'acme', principal_id: 'person:owner' }
  const binding = { runId: 'run:qcs', nodeId: 'send', workflowDigest: 'sha256:workflow', approvalDigest: 'sha256:human-approval', evidenceCount: 1 }
  const adapter = new DummyAdapter()
  const audit: string[] = []
  const authority = new KernelQcsAuthority(key, async (_intent, context) => {
    if (context.principal_id !== principal.principal_id) throw new Error('Unknown authenticated principal')
    return binding
  })
  const qcs = new QcsImpl({ authority, adapters: [adapter], routes: { email: 'dummy' }, audit: async (record) => { audit.push(record.status) } })
  const grant = (intent: QcsIntent): ExecutionAuthorizationRecord => issueExecutionAuthorization({
    tenantId: intent.tenant_id, runId: binding.runId, nodeId: binding.nodeId,
    actionFingerprint: intentFingerprint(intent), policySnapshot: 'sha256:policy', evidenceDigest: 'sha256:evidence',
    evidenceCount: binding.evidenceCount, workflowDigest: binding.workflowDigest, approvalDigest: binding.approvalDigest,
    capability: `qcs.${intent.operation}`, expiresAt: Date.now() + 60_000,
  }, key)
  const identity: AgentIdentity = { agent_id: 'agent:ops', display_name: 'Operations', roles: ['operator'], permissions: ['email'], channels: [{ channel_type: 'email', address: 'ops@example.com', metadata: {} }] }
  const registration: QcsIntent = { ...principal, operation: 'register_agent', body: { identity: identity as never } }
  await qcs.registerAgent(identity, { ...principal, authorization: grant(registration) })
  const request: SendMessageRequest = { from_agent_id: identity.agent_id, to_external_address: 'owner@example.com', channel_type: 'email', payload: 'hello' }
  const intent: QcsIntent = { ...principal, operation: 'send_message', body: { request: request as never, channel_type: 'email', from_address: 'ops@example.com', to_external_address: 'owner@example.com', adapter_id: 'dummy' } }
  const record = grant(intent)
  const context: QcsContext = { ...principal, authorization: record }
  const client = new KernelQcsClient(qcs)
  await assert.rejects(client.kernelSendMessage(identity.agent_id, request, principal), /authorization refused/)
  await assert.rejects(client.kernelSendMessage(identity.agent_id, { ...request, payload: 'changed after approval' }, context), /authorization refused/)
  await assert.rejects(client.kernelSendMessage(identity.agent_id, request, { ...context, principal_id: 'person:intruder' }), /authorization refused/)
  await assert.rejects(client.kernelSendMessage(identity.agent_id, request, { ...context, authorization: { ...record, tenantId: 'other' } }), /authorization refused/)
  const expired = issueExecutionAuthorization({ ...record, authorizationId: 'auth:expired', issuedAt: Date.now() - 5000, expiresAt: Date.now() - 1000 }, key, Date.now() - 5000)
  await assert.rejects(client.kernelSendMessage(identity.agent_id, request, { ...principal, authorization: expired }), /authorization refused/)
  assert.equal(adapter.messages.length, 0, 'all grant refusals happen before transport dispatch')
  const simultaneous = await Promise.allSettled([
    client.kernelSendMessage(identity.agent_id, request, context),
    client.kernelSendMessage(identity.agent_id, request, context),
  ])
  assert.equal(simultaneous.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(adapter.messages.length, 1)
  assert.equal(adapter.messages[0]!.tenant_id, 'acme')
  assert.ok(audit.includes('refused') && audit.includes('simulated'))
})

test('email: only addresses on the list qualify, and look-alikes do not', () => {
  const list = ['ops@example.com', '@team.example.org']
  assert.equal(emailRecipientAllowed('OPS@example.com', list), true)
  assert.equal(emailRecipientAllowed('anyone@team.example.org', list), true)
  for (const bad of ['boss@example.com', 'a@evil.team.example.org', 'a@team.example.org.evil.com', 'x@y@team.example.org', 'ops@example.com, spy@evil.com', 'Ops <ops@example.com>', '', 'ops@example']) {
    assert.equal(emailRecipientAllowed(bad, list), false, bad)
  }
})

test('email: a valid call posts once to Resend with the key, the idempotency key and one allowed recipient', async () => {
  const http = fakeHttp({ body: '{"id":"msg_123"}' })
  const tool = resendNotificationTool({ apiKey: API_KEY, from: 'quicksilver@example.com', recipients: ['ops@example.com'], fetcher: http.fetcher })
  const out = await tool.run(call('notification.send', { to: 'Ops@Example.com', subject: 'Report ready', text: 'The margin report is ready.' })) as Record<string, unknown>
  assert.equal(http.sent.length, 1)
  assert.equal(http.sent[0]!.url, 'https://api.resend.com/emails')
  assert.equal(http.sent[0]!.headers.authorization, `Bearer ${API_KEY}`)
  assert.equal(http.sent[0]!.headers['idempotency-key'], 'ap-1')
  assert.equal(http.sent[0]!.redirect, 'error')
  assert.deepEqual(JSON.parse(http.sent[0]!.body), { from: 'quicksilver@example.com', to: ['ops@example.com'], subject: 'Report ready', text: 'The margin report is ready.' })
  assert.deepEqual({ executed: out.executed, dryRun: out.dryRun, messageId: out.messageId }, { executed: true, dryRun: false, messageId: 'msg_123' })
  assert.ok(!JSON.stringify(out).includes(API_KEY), 'the key is never in a result')
})

test('email: a recipient off the list, a multi-line subject or an oversized body never reaches the network', async () => {
  const http = fakeHttp()
  const tool = resendNotificationTool({ apiKey: API_KEY, from: 'quicksilver@example.com', recipients: ['ops@example.com'], fetcher: http.fetcher })
  for (const input of [
    { to: 'customer@gmail.com', subject: 's', text: 't' },
    { to: 'ops@example.com', subject: 'a\nBcc: spy@evil.com', text: 't' },
    { to: 'ops@example.com', subject: '', text: 't' },
    { to: 'ops@example.com', subject: 's', text: 'x'.repeat(5001) },
    { to: ['ops@example.com'], subject: 's', text: 't' },
  ]) {
    assert.ok(tool.validate!(input), JSON.stringify(input).slice(0, 50))
    await assert.rejects(tool.run(call('notification.send', input)))
  }
  assert.equal(http.sent.length, 0)
})

test('email: a provider error or a dropped connection is a failure that names no secret', async () => {
  const rejected = resendNotificationTool({ apiKey: API_KEY, from: 'quicksilver@example.com', recipients: ['ops@example.com'], fetcher: fakeHttp({ status: 403 }).fetcher })
  await assert.rejects(rejected.run(call('notification.send', { to: 'ops@example.com', subject: 's', text: 't' })), (e: Error) => /HTTP 403/.test(e.message) && !e.message.includes(API_KEY))
  const dropped = resendNotificationTool({ apiKey: API_KEY, from: 'quicksilver@example.com', recipients: ['ops@example.com'], fetcher: fakeHttp(new Error(`socket closed ${API_KEY}`)).fetcher })
  await assert.rejects(dropped.run(call('notification.send', { to: 'ops@example.com', subject: 's', text: 't' })), (e: Error) => /may or may not have been delivered/.test(e.message) && !e.message.includes(API_KEY))
  assert.throws(() => resendNotificationTool({ apiKey: '', from: 'a@b.co', recipients: ['a@b.co'] }), /needs an API key/)
  assert.throws(() => resendNotificationTool({ apiKey: API_KEY, from: 'a@b.co', recipients: [] }), /at least one allowed recipient/)
})

// ── Webhook ───────────────────────────────────────────────────────────────

const publicResolver = async () => ['93.184.216.34']
const hook = (over: Partial<Parameters<typeof signedWebhookTool>[0]> = {}, http = fakeHttp()) =>
  ({ http, tool: signedWebhookTool({ allowedHosts: ['hooks.example.com'], signingSecret: SECRET, fetcher: http.fetcher, resolver: publicResolver, now: () => 1_780_000_000_000, ...over }) })

test('webhook: a valid call posts once, signed so the receiver can verify it, to the allowed host only', async () => {
  const { http, tool } = hook()
  const out = await tool.run(call('webhook.dispatch', { url: 'https://hooks.example.com/quicksilver', payload: { report: 'margin', ready: true }, eventType: 'report.ready' })) as Record<string, unknown>
  assert.equal(http.sent.length, 1)
  const sent = http.sent[0]!
  assert.equal(sent.url, 'https://hooks.example.com/quicksilver')
  assert.equal(sent.redirect, 'error')
  assert.equal(sent.headers['idempotency-key'], 'ap-1')
  assert.equal(sent.headers['x-quicksilver-timestamp'], '1780000000')
  assert.equal(sent.headers['x-quicksilver-signature'], signWebhook(SECRET, 1_780_000_000, sent.body), 'the receiver can recompute it')
  assert.deepEqual(JSON.parse(sent.body), { eventType: 'report.ready', actionId: 'ap-1', payload: { report: 'margin', ready: true } })
  assert.deepEqual({ executed: out.executed, dryRun: out.dryRun, targetHost: out.targetHost }, { executed: true, dryRun: false, targetHost: 'hooks.example.com' })
  assert.ok(!JSON.stringify(out).includes(SECRET))
})

test('webhook: anything that could aim it somewhere else is refused before any request', async () => {
  const { http, tool } = hook()
  const payload = { a: 1 }
  for (const url of [
    'http://hooks.example.com/x', 'https://evil.example.net/x', 'https://hooks.example.com.evil.net/x', 'https://user:pw@hooks.example.com/x',
    'https://hooks.example.com:8443/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'not a url',
  ]) {
    assert.ok(tool.validate!({ url, payload }), url)
    await assert.rejects(tool.run(call('webhook.dispatch', { url, payload })), (e: Error) => e instanceof Error, url)
  }
  assert.ok(tool.validate!({ url: 'https://hooks.example.com/x', payload: [1] }))
  assert.ok(tool.validate!({ url: 'https://hooks.example.com/x', payload: { big: 'x'.repeat(20_000) } }))
  assert.ok(tool.validate!({ url: 'https://hooks.example.com/x', payload, eventType: 'a b' }))
  assert.equal(http.sent.length, 0)
})

test('webhook: an allowed host that resolves to a private address is refused; so is one that does not resolve', async () => {
  for (const addresses of [['10.0.0.5'], ['93.184.216.34', '127.0.0.1'], ['::1'], ['::ffff:192.168.1.1'], ['fd00::1'], []]) {
    const { http, tool } = hook({ resolver: async () => addresses })
    await assert.rejects(tool.run(call('webhook.dispatch', { url: 'https://hooks.example.com/x', payload: {} })), /private or reserved address/)
    assert.equal(http.sent.length, 0)
  }
  const { http, tool } = hook({ resolver: async () => { throw new Error('ENOTFOUND') } })
  await assert.rejects(tool.run(call('webhook.dispatch', { url: 'https://hooks.example.com/x', payload: {} })), /could not be resolved/)
  assert.equal(http.sent.length, 0)
  for (const a of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::', '::1', 'fe80::1', 'fc00::1']) assert.equal(isPrivateAddress(a), true, a)
  for (const a of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateAddress(a), false, a)
})

test('webhook: a receiver error is a failure; bad settings are refused at start', async () => {
  const { tool } = hook({}, fakeHttp({ status: 500 }))
  await assert.rejects(tool.run(call('webhook.dispatch', { url: 'https://hooks.example.com/x', payload: {} })), /answered HTTP 500/)
  assert.throws(() => signedWebhookTool({ allowedHosts: ['hooks.example.com'], signingSecret: 'short' }), /at least 32/)
  for (const hosts of [[], ['*.example.com'], ['10.0.0.1'], ['bad host']]) assert.throws(() => signedWebhookTool({ allowedHosts: hosts, signingSecret: SECRET }), /exact hostnames/)
})

// ── Through the approval path ─────────────────────────────────────────────

test('approved actions: real adapters are marked live, reject unrunnable proposals up front, and send exactly once on approval', async () => {
  const http = fakeHttp({ body: '{"id":"msg_9"}' })
  const email = resendNotificationTool({ apiKey: API_KEY, from: 'quicksilver@example.com', recipients: ['ops@example.com'], fetcher: http.fetcher })
  const tools = [email, ...dryRunTools().filter((t) => t.manifest.id !== 'notification.send')]
  const key = { keyId: 'acme:host-1', secret: '0123456789abcdef0123456789abcdef' }
  const build = (list = tools) => new ActionService({ tenantId: 'acme', store, executor: new EffectfulToolExecutor({ tools: list, signingKey: key }), policy: { enabledTools: ['notification.send', 'webhook.dispatch'] }, signingKey: key })
  const store = new MemoryActionStore('acme')
  const svc = build()
  assert.deepEqual(svc.summary().tools.map((t) => [t.id, t.live]), [['notification.send', true], ['webhook.dispatch', false]])

  const bad = await svc.propose({ id: 'agent-genesis', kind: 'agent' }, { toolId: 'notification.send', input: { to: 'customer@gmail.com', subject: 's', text: 't' }, reason: 'Tell the customer.', evidence: ['x'] })
  assert.ok(!bad.ok && /allowed recipients/.test(bad.error), 'nobody is asked to approve something that cannot run')

  const ok = await svc.propose({ id: 'agent-genesis', kind: 'agent' }, { toolId: 'notification.send', input: { to: 'ops@example.com', subject: 'Report ready', text: 'The report is ready.' }, reason: 'Tell ops.', evidence: ['report:1'] })
  assert.ok(ok.ok)
  assert.equal(http.sent.length, 0, 'proposing sends nothing')
  const done = await svc.approve(ok.proposal.id, { id: 'person-boss' })
  assert.ok(done.ok && done.proposal.status === 'executed')
  assert.equal(done.proposal.result?.dryRun, undefined, 'a real send is not labeled a dry run')
  assert.equal(http.sent.length, 1)
  const again = await svc.approve(ok.proposal.id, { id: 'person-boss' })
  assert.ok(!again.ok)
  assert.equal(http.sent.length, 1, 'approving twice sends once')

  // Changing who may be emailed changes the policy in force, so a pending proposal made before is stale.
  const pending = await svc.propose({ id: 'agent-genesis', kind: 'agent' }, { toolId: 'notification.send', input: { to: 'ops@example.com', subject: 'Second', text: 'Again.' }, reason: 'Tell ops.', evidence: ['report:2'] })
  assert.ok(pending.ok)
  const wider = build([resendNotificationTool({ apiKey: API_KEY, from: 'quicksilver@example.com', recipients: ['ops@example.com', '@example.com'], fetcher: http.fetcher }), ...dryRunTools().filter((t) => t.manifest.id !== 'notification.send')])
  const stale = await wider.approve(pending.proposal.id, { id: 'person-boss' })
  assert.ok(!stale.ok && /policy changed/.test(stale.error))
  assert.equal(http.sent.length, 1)
})

test('credential-free local outbox: dispatches approved operational notifications without external credentials', async () => {
  const delivered: Array<Record<string, unknown>> = []
  const tool = localOutboxNotificationTool({
    from: 'quicksilver@local.internal',
    recipients: ['admin@local.internal'],
    deliverMessage: (msg) => { delivered.push(msg) },
  })
  const key = { keyId: 'acme:host-1', secret: '0123456789abcdef0123456789abcdef' }
  const store = new MemoryActionStore('acme')
  const svc = new ActionService({
    tenantId: 'acme',
    store,
    executor: new EffectfulToolExecutor({ tools: [tool], signingKey: key }),
    policy: { enabledTools: ['notification.send'] },
    signingKey: key,
  })

  // Propose local notification
  const prop = await svc.propose(
    { id: 'agent-local', kind: 'agent' },
    { toolId: 'notification.send', input: { to: 'admin@local.internal', subject: 'System Health Check', text: 'All local workers healthy.' }, reason: 'Routine notice', evidence: ['check:1'] },
  )
  assert.ok(prop.ok)
  assert.equal(delivered.length, 0, 'no delivery before approval')

  // Approve and execute
  const approved = await svc.approve(prop.proposal.id, { id: 'human-operator' })
  assert.ok(approved.ok && approved.proposal.status === 'executed')
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0]!.to, 'admin@local.internal')
  assert.equal(delivered[0]!.subject, 'System Health Check')
  assert.equal(delivered[0]!.text, 'All local workers healthy.')
  assert.ok(typeof delivered[0]!.id === 'string' && (delivered[0]!.id as string).startsWith('outbox-'))
  assert.ok(approved.proposal.result?.auditId)
  assert.equal(approved.proposal.result?.dryRun, undefined)
})

test('credential-free local file mutation: applies approved changes and prevents traversal', async () => {
  const tool = localFileMutationTool({ baseDir: '/workspace/safe', allowedExtensions: ['.json', '.txt'] })
  const key = { keyId: 'acme:host-1', secret: '0123456789abcdef0123456789abcdef' }
  const store = new MemoryActionStore('acme')
  const svc = new ActionService({
    tenantId: 'acme',
    store,
    executor: new EffectfulToolExecutor({ tools: [tool], signingKey: key }),
    policy: { enabledTools: ['file.mutate'] },
    signingKey: key,
  })

  // Traversal or unapproved extension is rejected up front
  const badPath = await svc.propose(
    { id: 'agent-local', kind: 'agent' },
    { toolId: 'file.mutate', input: { path: '../escape.txt', content: 'hack', action: 'write' }, reason: 'Bad write', evidence: ['e1'] },
  )
  assert.ok(!badPath.ok && /clean relative path/.test(badPath.error))

  const badExt = await svc.propose(
    { id: 'agent-local', kind: 'agent' },
    { toolId: 'file.mutate', input: { path: 'script.sh', content: 'echo 1', action: 'write' }, reason: 'Bad ext', evidence: ['e1'] },
  )
  assert.ok(!badExt.ok && /must end in one of/.test(badExt.error))

  // Valid proposal executes cleanly upon approval
  const good = await svc.propose(
    { id: 'agent-local', kind: 'agent' },
    { toolId: 'file.mutate', input: { path: 'reports/summary.json', content: '{"status":"ok"}', action: 'write' }, reason: 'Save summary', evidence: ['e1'] },
  )
  assert.ok(good.ok)
  const approved = await svc.approve(good.proposal.id, { id: 'human-operator' })
  assert.ok(approved.ok && approved.proposal.status === 'executed')
  assert.ok(approved.proposal.result?.outputDigest)
  assert.equal(approved.proposal.result?.dryRun, undefined)
})

