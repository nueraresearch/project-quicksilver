import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CommunicationsDispatcher,
  formatMailtoUrl,
  type DraftedCommunicationRecord,
} from './communications.ts'
import type { ChannelAdapter, InboundMessage } from './channels/types.ts'

class MockEmailAdapter implements ChannelAdapter {
  readonly id = 'email'
  readonly kind = 'email' as const
  sent: Array<{ to: string; text: string }> = []

  async start(_onMessage: (m: InboundMessage) => void): Promise<void> {}
  async stop(): Promise<void> {}
  async send(to: string, text: string): Promise<void> {
    this.sent.push({ to, text })
  }
}

test('Communications: refuses to dispatch drafted communications without human approval', async () => {
  const dispatcher = new CommunicationsDispatcher()
  const unapproved: DraftedCommunicationRecord = {
    id: 'comm-1',
    kind: 'email',
    to: { email: 'client@example.com' },
    subject: 'Project Update',
    body: 'Drafted follow-up text.',
    status: 'draft',
  }

  const result = await dispatcher.dispatch(unapproved)
  assert.equal(result.success, false)
  assert.match(result.error ?? '', /must be "approved" by a human/)
})

test('Communications: dispatches approved email via configured EmailAdapter', async () => {
  const mockAdapter = new MockEmailAdapter()
  const dispatcher = new CommunicationsDispatcher([mockAdapter])

  const approved: DraftedCommunicationRecord = {
    id: 'comm-2',
    kind: 'email',
    to: { email: 'client@example.com' },
    subject: 'Approved follow-up',
    body: 'Hello there, here is the recap.',
    status: 'approved',
    deliveryChannel: 'email',
  }

  const result = await dispatcher.dispatch(approved)
  assert.equal(result.success, true)
  assert.equal(result.deliveredVia, 'email-adapter')
  assert.equal(mockAdapter.sent.length, 1)
  assert.equal(mockAdapter.sent[0]?.to, 'client@example.com')
})

test('Communications: falls back to mailto-export when no email adapter is wired', async () => {
  const dispatcher = new CommunicationsDispatcher([])

  const approved: DraftedCommunicationRecord = {
    id: 'comm-3',
    kind: 'email',
    to: { email: 'alice@wonderland.org' },
    subject: 'Meeting recap',
    body: 'Notes from our session.',
    status: 'approved',
    deliveryChannel: 'email',
  }

  const result = await dispatcher.dispatch(approved)
  assert.equal(result.success, true)
  assert.equal(result.deliveredVia, 'mailto-export')
  assert.ok(result.externalId?.startsWith('mailto:alice%40wonderland.org?'))
})

test('Communications: formatMailtoUrl creates valid URI and throws without email', () => {
  const valid: DraftedCommunicationRecord = {
    id: 'comm-4',
    kind: 'email',
    to: { email: 'test@example.com' },
    subject: 'Test Subject',
    body: 'Hello World',
    status: 'approved',
  }

  const url = formatMailtoUrl(valid)
  assert.ok(url.includes('mailto:test%40example.com?'))
  assert.ok(url.includes('subject=Test+Subject'))

  assert.throws(
    () => formatMailtoUrl({ ...valid, to: {} }),
    /recipient has no email address/,
  )
})
