/**
 * Operator Communications Engine.
 *
 * Implements governed dispatch for drafted communications:
 * - Systems of record: draftedCommunication documents.
 * - Human-in-the-loop: communication must be in 'approved' status to dispatch.
 * - Fail-closed: unapproved or missing recipient refuses dispatch.
 * - Sync target: dispatches to external channel adapters (email, slack, etc.) or generates mailto/export payloads.
 */

import type { ChannelAdapter } from './channels/types.ts'

export interface DraftedCommunicationRecord {
  id: string
  kind: 'email' | 'message' | 'note'
  to: {
    name?: string
    email?: string
    handle?: string
  }
  subject?: string
  body: string
  status: 'draft' | 'approved' | 'sent' | 'cancelled'
  deliveryChannel?: string
  linkedCommitmentId?: string
  linkedDecisionId?: string
  createdAt?: string
  sentAt?: string
}

export interface DispatchResult {
  success: boolean
  communicationId: string
  deliveredVia: string
  dispatchedAt: string
  externalId?: string
  error?: string
}

export function formatMailtoUrl(comm: DraftedCommunicationRecord): string {
  if (!comm.to.email) {
    throw new Error(`Cannot generate mailto URL for communication "${comm.id}": recipient has no email address.`)
  }
  const params = new URLSearchParams()
  if (comm.subject) params.set('subject', comm.subject)
  params.set('body', comm.body)
  return `mailto:${encodeURIComponent(comm.to.email)}?${params.toString()}`
}

export class CommunicationsDispatcher {
  private readonly adapters = new Map<string, ChannelAdapter>()

  constructor(adapters: ChannelAdapter[] = []) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.kind, adapter)
      this.adapters.set(adapter.id, adapter)
    }
  }

  /**
   * Dispatch an approved communication.
   * Enforces fail-closed human approval: only 'approved' status may be dispatched.
   */
  async dispatch(comm: DraftedCommunicationRecord, now = new Date()): Promise<DispatchResult> {
    if (comm.status !== 'approved') {
      return {
        success: false,
        communicationId: comm.id,
        deliveredVia: comm.deliveryChannel ?? 'none',
        dispatchedAt: now.toISOString(),
        error: `Refusing to dispatch communication "${comm.id}": status is "${comm.status}", must be "approved" by a human.`,
      }
    }

    const channel = comm.deliveryChannel ?? (comm.kind === 'email' ? 'email' : 'message')

    if (channel === 'email') {
      const recipient = comm.to.email
      if (!recipient) {
        return {
          success: false,
          communicationId: comm.id,
          deliveredVia: channel,
          dispatchedAt: now.toISOString(),
          error: `Cannot dispatch email: recipient email address is missing for "${comm.id}".`,
        }
      }

      const emailAdapter = this.adapters.get('email')
      if (emailAdapter) {
        try {
          await emailAdapter.send(recipient, comm.body)
          return {
            success: true,
            communicationId: comm.id,
            deliveredVia: 'email-adapter',
            dispatchedAt: now.toISOString(),
          }
        } catch (err) {
          return {
            success: false,
            communicationId: comm.id,
            deliveredVia: 'email-adapter',
            dispatchedAt: now.toISOString(),
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }

      // If no live adapter is wired, provide mailto export target
      return {
        success: true,
        communicationId: comm.id,
        deliveredVia: 'mailto-export',
        dispatchedAt: now.toISOString(),
        externalId: formatMailtoUrl(comm),
      }
    }

    // Generic adapter lookup
    const adapter = this.adapters.get(channel)
    if (!adapter) {
      return {
        success: false,
        communicationId: comm.id,
        deliveredVia: channel,
        dispatchedAt: now.toISOString(),
        error: `No configured adapter for delivery channel "${channel}".`,
      }
    }

    const recipient = comm.to.handle ?? comm.to.email ?? comm.to.name
    if (!recipient) {
      return {
        success: false,
        communicationId: comm.id,
        deliveredVia: channel,
        dispatchedAt: now.toISOString(),
        error: `Missing recipient identifier for channel "${channel}".`,
      }
    }

    try {
      await adapter.send(recipient, comm.body)
      return {
        success: true,
        communicationId: comm.id,
        deliveredVia: channel,
        dispatchedAt: now.toISOString(),
      }
    } catch (err) {
      return {
        success: false,
        communicationId: comm.id,
        deliveredVia: channel,
        dispatchedAt: now.toISOString(),
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
