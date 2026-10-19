import assert from 'node:assert/strict'
import { test } from 'node:test'

import { intentFingerprint } from '../src/core/config.ts'
import { QcsEvents } from '../src/core/events.ts'
import { IdentityRegistry } from '../src/core/identity.ts'
import { QcsImpl } from '../src/core/router.ts'
import { DummyAdapter } from '../src/adapters/dummy_adapter.ts'
import { TwilioAdapter } from '../src/adapters/twilio_adapter.ts'
import { SendgridAdapter } from '../src/adapters/sendgrid_adapter.ts'
import { SmtpAdapter } from '../src/adapters/smtp_adapter.ts'
import { sendEmail, handleIncomingEmail } from '../src/channels/email.ts'
import { sendSms, handleIncomingSms } from '../src/channels/sms.ts'
import { sendSignal, handleIncomingSignal } from '../src/channels/signal.ts'
import { placeCall, handleIncomingCall } from '../src/channels/voice.ts'
import { emitIoTCommand, handleIoTEvent } from '../src/channels/iot.ts'
import type { AgentIdentity, QcsEvent } from '../src/interfaces/types.ts'

const identity: AgentIdentity = { agent_id: 'agent:ops', display_name: 'Operations', roles: ['operator'], permissions: ['email'], channels: [{ channel_type: 'email', address: 'ops@example.com', metadata: {} }] }

test('identity registry isolates tenants, validates bindings, and returns copies', () => {
  const registry = new IdentityRegistry()
  registry.set('acme', identity)
  assert.equal(registry.get('other', identity.agent_id), null)
  registry.get('acme', identity.agent_id)!.channels[0]!.address = 'spy@example.com'
  assert.equal(registry.get('acme', identity.agent_id)!.channels[0]!.address, 'ops@example.com')
  assert.throws(() => registry.set('acme', { ...identity, channels: [...identity.channels, ...identity.channels] }), /unique/)
})

test('intent fingerprints are canonical and refuse non-JSON data', () => {
  const common = { operation: 'send_message' as const, tenant_id: 'acme', principal_id: 'person:owner' }
  assert.equal(intentFingerprint({ ...common, body: { to: 'ops', text: 'hello' } }), intentFingerprint({ ...common, body: { text: 'hello', to: 'ops' } }))
  assert.notEqual(intentFingerprint({ ...common, body: { to: 'ops' } }), intentFingerprint({ ...common, body: { to: 'spy' } }))
  assert.throws(() => intentFingerprint({ ...common, body: { value: NaN } }), /JSON/)
})

test('event subscriptions isolate tenants and support unsubscribe', async () => {
  const events = new QcsEvents()
  const received: QcsEvent[] = []
  const off = events.subscribe('acme', async (event) => { received.push(event) })
  events.subscribe('other', async () => { assert.fail('cross-tenant delivery') })
  const event: QcsEvent = { id: 'event:1', tenant_id: 'acme', source: 'external', type: 'incoming_sms', payload: { text: 'hello' }, created_at: new Date().toISOString() }
  await events.emit(event)
  off()
  await events.emit(event)
  assert.equal(received.length, 1)
})

test('router requires an authority and audits refusals rather than trusting agent permissions', async () => {
  const audit: string[] = []
  const qcs = new QcsImpl({ adapters: [new DummyAdapter()], routes: { email: 'dummy' }, audit: async (record) => { audit.push(record.status) } })
  await assert.rejects(qcs.registerAgent(identity, { tenant_id: 'acme', principal_id: 'person:owner' }), /authorization refused/)
  assert.deepEqual(audit, ['refused'])
})

test('router routes authorized messages to a dummy adapter and fails closed on audit failure', async () => {
  const adapter = new DummyAdapter()
  const context = { tenant_id: 'acme', principal_id: 'person:owner' }
  let failAudit = false
  const authorized: string[] = []
  const qcs = new QcsImpl({ adapters: [adapter], routes: { email: 'dummy' }, authority: { authorizeAndConsume: async (intent) => { authorized.push(intent.operation) } }, audit: async () => { if (failAudit) throw new Error('disk full') } })
  await qcs.registerAgent(identity, context)
  const request = { from_agent_id: identity.agent_id, to_external_address: 'owner@example.com', channel_type: 'email' as const, payload: 'hello' }
  assert.equal((await qcs.sendMessage(request, context)).status, 'simulated')
  assert.equal(adapter.messages.length, 1)
  assert.deepEqual(authorized, ['register_agent', 'send_message'])
  failAudit = true
  await assert.rejects(qcs.sendMessage(request, context), /disk full/)
  assert.equal(adapter.messages.length, 1)
  await assert.rejects(qcs.sendMessage(request, { ...context, tenant_id: 'other' }), /no binding/)
  await assert.rejects(qcs.sendMessage({ ...request, to_agent_id: 'another' }, context), /exactly one/)
})

test('unimplemented provider adapters never claim delivery', async () => {
  for (const adapter of [new TwilioAdapter(), new SendgridAdapter()]) {
    await assert.rejects(adapter.send({} as never), /not implemented/)
  }
})

test('all channel helpers route outbound actions and normalize authorized inbound events', async () => {
  const adapter = new DummyAdapter()
  const channels = ['voice', 'sms', 'email', 'signal', 'iot'] as const
  const context = { tenant_id: 'acme', principal_id: 'person:owner' }
  const qcs = new QcsImpl({ adapters: [adapter], routes: Object.fromEntries(channels.map((channel) => [channel, 'dummy'])), authority: { authorizeAndConsume: async () => {} }, audit: async () => {} })
  await qcs.registerAgent({ ...identity, channels: channels.map((channel_type) => ({ channel_type, address: `source:${channel_type}`, metadata: {} })) }, context)
  const request = { from_agent_id: identity.agent_id, to_external_address: 'target', payload: 'hello' }
  await sendEmail(qcs, request, context)
  await sendSms(qcs, request, context)
  await sendSignal(qcs, request, context)
  await placeCall(qcs, { from_agent_id: identity.agent_id, to_external_number: '+15555550100' }, context)
  await emitIoTCommand(qcs, { ...request, payload: { command: 'read' } }, context)
  assert.deepEqual(adapter.messages.map((message) => message.channel_type), ['email', 'sms', 'signal', 'voice', 'iot'])
  const events: QcsEvent[] = []
  const off = await qcs.subscribeToEvents(async (event) => { events.push(event) }, context)
  for (const receive of [handleIncomingEmail, handleIncomingSms, handleIncomingSignal, handleIncomingCall, handleIoTEvent]) {
    await receive(qcs, { type: 'incoming', payload: { text: 'hello' } }, context)
  }
  off()
  assert.equal(events.length, 5)
  assert.ok(events.every((event) => event.source === 'external' && event.tenant_id === 'acme'))
})

test('SMTP adapter uses an injected transport and never silently falls back to another provider', async () => {
  const submissions: string[] = []
  const adapter = new SmtpAdapter(async (message) => { submissions.push(message.text); return { messageId: 'smtp:1' } })
  const context = { tenant_id: 'acme', principal_id: 'person:owner' }
  const qcs = new QcsImpl({ adapters: [adapter], routes: { email: 'smtp' }, authority: { authorizeAndConsume: async () => {} }, audit: async () => {} })
  await qcs.registerAgent(identity, context)
  const result = await qcs.sendMessage({ from_agent_id: identity.agent_id, to_external_address: 'owner@example.com', channel_type: 'email', payload: { subject: 'Hello', text: 'Native SMTP' } }, context)
  assert.equal(result.status, 'accepted')
  assert.equal(result.external_id, 'smtp:1')
  assert.deepEqual(submissions, ['Native SMTP'])
})

test('completion-audit failure reports an ambiguous effect instead of claiming nothing was sent', async () => {
  const adapter = new DummyAdapter()
  const context = { tenant_id: 'acme', principal_id: 'person:owner' }
  const qcs = new QcsImpl({ adapters: [adapter], routes: { email: 'dummy' }, authority: { authorizeAndConsume: async () => {} }, audit: async (record) => {
    if (record.status === 'simulated') throw new Error('disk full')
  } })
  await qcs.registerAgent(identity, context)
  await assert.rejects(qcs.sendMessage({ from_agent_id: identity.agent_id, to_external_address: 'owner@example.com', channel_type: 'email', payload: 'hello' }, context), /may have occurred/)
  assert.equal(adapter.messages.length, 1)
})

test('denied ingress cannot publish events and subscriber failures are surfaced', async () => {
  let deny = false
  const context = { tenant_id: 'acme', principal_id: 'connector:email' }
  const qcs = new QcsImpl({ adapters: [], routes: {}, authority: { authorizeAndConsume: async () => { if (deny) throw new Error('invalid ingress signature') } }, audit: async () => {} })
  const received: QcsEvent[] = []
  await qcs.subscribeToEvents(async (event) => { received.push(event) }, context)
  deny = true
  const request = { channel_type: 'email' as const, type: 'incoming_email', payload: { text: 'hello' } }
  await assert.rejects(qcs.receiveEvent(request, context), /authorization refused/)
  assert.equal(received.length, 0)
  deny = false
  await qcs.subscribeToEvents(async () => { throw new Error('subscriber failed') }, context)
  await assert.rejects(qcs.receiveEvent(request, context), /operation failed/)
  assert.equal(received.length, 1)
})