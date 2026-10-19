import { randomUUID } from 'node:crypto'

import { intentFingerprint, requireText, snapshot, type QcsConfig } from './config.ts'
import { QcsEvents } from './events.ts'
import { IdentityRegistry, validateIdentity } from './identity.ts'
import type { QCS } from '../interfaces/qcs_api.ts'
import type {
  AgentIdentity, BroadcastRequest, BroadcastResult, ChannelType, IncomingEventRequest,
  IoTCommandRequest, JsonObject, Message, PlaceCallRequest, QcsAdapter, QcsContext,
  QcsEvent, QcsEventHandler, QcsIntent, SendMessageRequest, SendMessageResult, UnsubscribeFn,
} from '../interfaces/types.ts'

const CHANNELS: readonly ChannelType[] = ['voice', 'sms', 'email', 'signal', 'iot']

export class QcsImpl implements QCS {
  private readonly identities = new IdentityRegistry()
  private readonly events = new QcsEvents()
  private readonly adapters = new Map<string, QcsAdapter>()
  private readonly config: QcsConfig

  constructor(config: QcsConfig) {
    if (typeof config.audit !== 'function') throw new Error('QCS requires an audit sink.')
    this.config = { ...config, routes: snapshot(config.routes) }
    for (const adapter of config.adapters) {
      requireText(adapter.id, 'adapter id')
      if (this.adapters.has(adapter.id)) throw new Error('Duplicate QCS adapter id.')
      this.adapters.set(adapter.id, adapter)
    }
    for (const [channel, adapterId] of Object.entries(config.routes)) {
      if (!CHANNELS.includes(channel as ChannelType) || !this.adapters.get(adapterId)?.channels.includes(channel as ChannelType)) throw new Error('Invalid QCS route or unsupported adapter channel.')
    }
  }

  private context(context: QcsContext): QcsContext {
    requireText(context?.tenant_id, 'tenant')
    requireText(context?.principal_id, 'principal')
    return { tenant_id: context.tenant_id, principal_id: context.principal_id, authorization: context.authorization }
  }

  private async guarded<T>(operation: QcsIntent['operation'], body: JsonObject, supplied: QcsContext, effect: () => Promise<T>, resultStatus: (value: T) => 'accepted' | 'simulated' = () => 'accepted'): Promise<T> {
    const context = this.context(supplied)
    const intent: QcsIntent = { operation, tenant_id: context.tenant_id, principal_id: context.principal_id, body: snapshot(body) }
    const base = { id: `qcs:audit:${randomUUID()}`, tenant_id: context.tenant_id, principal_id: context.principal_id, operation, intent_digest: intentFingerprint(intent) }
    const audit = async (status: 'attempt' | 'refused' | 'accepted' | 'simulated' | 'failed') => this.config.audit({ ...base, status, created_at: new Date().toISOString() })
    try {
      if (!this.config.authority) throw new Error('QCS authority is not configured; operation refused.')
      await this.config.authority.authorizeAndConsume(snapshot(intent), Object.freeze({ ...context }))
    } catch {
      await audit('refused')
      throw new Error('QCS authorization refused.')
    }
    await audit('attempt')
    let result: T
    try { result = await effect() } catch {
      await audit('failed')
      throw new Error('QCS operation failed; inspect the audit trail before retrying an effect.')
    }
    try { await audit(resultStatus(result)) } catch {
      throw new Error('QCS completion audit failed; the operation may have occurred. Do not retry blindly.')
    }
    return result
  }

  async registerAgent(identity: AgentIdentity, context: QcsContext): Promise<void> {
    const copy = validateIdentity(identity)
    const scope = this.context(context)
    await this.guarded('register_agent', { identity: copy as unknown as JsonObject }, scope, async () => { this.identities.set(scope.tenant_id, copy) })
  }

  async getAgentIdentity(agentId: string, context: QcsContext): Promise<AgentIdentity | null> {
    requireText(agentId, 'agent id')
    const scope = this.context(context)
    return this.guarded('read_identity', { agent_id: agentId }, scope, async () => this.identities.get(scope.tenant_id, agentId))
  }

  async subscribeToEvents(handler: QcsEventHandler, context: QcsContext): Promise<UnsubscribeFn> {
    if (typeof handler !== 'function') throw new Error('QCS requires an event handler.')
    const scope = this.context(context)
    let unsubscribe: UnsubscribeFn | undefined
    try {
      return await this.guarded('subscribe_events', {}, scope, async () => {
        unsubscribe = this.events.subscribe(scope.tenant_id, handler)
        return unsubscribe
      })
    } catch (error) { unsubscribe?.(); throw error }
  }

  private async dispatch(channel: ChannelType, request: { from_agent_id: string; to_agent_id?: string; to_external_address?: string; payload: string | JsonObject; metadata?: JsonObject }, supplied: QcsContext, operation: QcsIntent['operation']): Promise<SendMessageResult> {
    const context = this.context(supplied)
    const copy = snapshot(request)
    requireText(copy.from_agent_id, 'sender agent')
    if (!CHANNELS.includes(channel)) throw new Error('Unsupported QCS channel.')
    if (Boolean(copy.to_agent_id) === Boolean(copy.to_external_address)) throw new Error('QCS requires exactly one destination.')
    if ((typeof copy.payload !== 'string' && (!copy.payload || Array.isArray(copy.payload) || typeof copy.payload !== 'object')) || (typeof copy.payload === 'string' && !copy.payload.trim())) throw new Error('QCS requires a nonempty text or object payload.')
    if (copy.metadata !== undefined && (!copy.metadata || typeof copy.metadata !== 'object' || Array.isArray(copy.metadata))) throw new Error('QCS metadata must be an object.')
    const sender = this.identities.get(context.tenant_id, copy.from_agent_id)
    const source = sender?.channels.find((binding) => binding.channel_type === channel)
    if (!source) throw new Error('QCS sender has no binding for this channel.')
    const target = copy.to_agent_id ? this.identities.get(context.tenant_id, copy.to_agent_id)?.channels.find((binding) => binding.channel_type === channel)?.address : copy.to_external_address
    requireText(target, 'destination address')
    const adapter = this.adapters.get(this.config.routes[channel] ?? '')
    if (!adapter) throw new Error('QCS channel has no configured adapter.')
    const body: JsonObject = { request: copy as unknown as JsonObject, channel_type: channel, from_address: source.address, to_external_address: target, adapter_id: adapter.id }
    return this.guarded(operation, body, context, async () => {
      const message: Message = {
        id: `qcs:message:${randomUUID()}`, tenant_id: context.tenant_id, from_agent_id: copy.from_agent_id,
        ...(copy.to_agent_id ? { to_agent_id: copy.to_agent_id } : {}), from_address: source.address,
        to_external_address: target, channel_type: channel, payload: copy.payload,
        created_at: new Date().toISOString(), metadata: copy.metadata ?? {},
      }
      const result = await adapter.send(snapshot(message))
      if (!result || !['accepted', 'simulated'].includes(result.status) || (result.external_id !== undefined && typeof result.external_id !== 'string')) throw new Error('Invalid QCS adapter result.')
      return { message_id: message.id, adapter_id: adapter.id, ...result }
    }, (result) => result.status)
  }

  sendMessage(request: SendMessageRequest, context: QcsContext): Promise<SendMessageResult> {
    if (!request || !['sms', 'email', 'signal', 'iot'].includes(request.channel_type)) return Promise.reject(new Error('Unsupported QCS message channel.'))
    return this.dispatch(request.channel_type, request, context, 'send_message')
  }

  placeCall(request: PlaceCallRequest, context: QcsContext): Promise<SendMessageResult> {
    const copy = snapshot(request)
    return this.dispatch('voice', { from_agent_id: copy.from_agent_id, to_external_address: copy.to_external_number, payload: { action: 'place_call' }, ...(copy.metadata ? { metadata: copy.metadata } : {}) }, context, 'place_call')
  }

  emitIoTCommand(request: IoTCommandRequest, context: QcsContext): Promise<SendMessageResult> {
    return this.dispatch('iot', request, context, 'emit_iot_command')
  }

  async receiveEvent(request: IncomingEventRequest, context: QcsContext): Promise<QcsEvent> {
    const copy = snapshot(request)
    const scope = this.context(context)
    if (!CHANNELS.includes(copy.channel_type)) throw new Error('Unsupported QCS event channel.')
    requireText(copy.type, 'event type')
    if (!copy.payload || typeof copy.payload !== 'object' || Array.isArray(copy.payload)) throw new Error('QCS event payload must be an object.')
    if (copy.routing_hint !== undefined) requireText(copy.routing_hint, 'routing hint')
    return this.guarded('receive_event', { request: copy as unknown as JsonObject }, scope, async () => {
      const event: QcsEvent = { id: `qcs:event:${randomUUID()}`, tenant_id: scope.tenant_id, source: 'external', type: copy.type, payload: { ...copy.payload, channel_type: copy.channel_type }, created_at: new Date().toISOString(), ...(copy.routing_hint ? { routing_hint: copy.routing_hint } : {}) }
      await this.events.emit(event)
      return event
    })
  }

  async broadcastMessage(request: BroadcastRequest, contexts: QcsContext[]): Promise<BroadcastResult> {
    const copy = snapshot(request)
    if (!Array.isArray(copy.messages) || !copy.messages.length || copy.messages.length > 100 || contexts.length !== copy.messages.length) throw new Error('QCS broadcast needs 1 to 100 messages and one authorization context per message.')
    const results: SendMessageResult[] = []
    for (const [index, message] of copy.messages.entries()) results.push(await this.sendMessage(message, contexts[index]!))
    return { results }
  }
}