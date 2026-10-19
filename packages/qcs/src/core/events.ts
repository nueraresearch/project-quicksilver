import { requireText, snapshot } from './config.ts'
import type { QcsEvent, QcsEventHandler, UnsubscribeFn } from '../interfaces/types.ts'

export class QcsEvents {
  private readonly handlers = new Map<string, Set<QcsEventHandler>>()

  subscribe(tenantId: string, handler: QcsEventHandler): UnsubscribeFn {
    requireText(tenantId, 'subscription tenant')
    const handlers = this.handlers.get(tenantId) ?? new Set<QcsEventHandler>()
    handlers.add(handler)
    this.handlers.set(tenantId, handlers)
    return () => {
      handlers.delete(handler)
      if (!handlers.size) this.handlers.delete(tenantId)
    }
  }

  async emit(event: QcsEvent): Promise<void> {
    const copy = snapshot(event)
    requireText(copy.tenant_id, 'event tenant')
    const results = await Promise.allSettled([...(this.handlers.get(copy.tenant_id) ?? [])].map(async (handler) => handler(snapshot(copy))))
    if (results.some((result) => result.status === 'rejected')) throw new Error('QCS event delivery failed; the event was not delivered to every subscriber.')
  }
}