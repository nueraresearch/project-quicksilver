export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export type ChannelType = 'voice' | 'sms' | 'email' | 'signal' | 'iot'

export interface ChannelBinding {
  channel_type: ChannelType
  address: string
  metadata: JsonObject
}

export interface AgentIdentity {
  agent_id: string
  display_name: string
  roles: string[]
  permissions: string[]
  channels: ChannelBinding[]
}

export interface SendMessageRequest {
  from_agent_id: string
  to_agent_id?: string
  to_external_address?: string
  channel_type: Exclude<ChannelType, 'voice'>
  payload: string | JsonObject
  metadata?: JsonObject
}

export interface PlaceCallRequest {
  from_agent_id: string
  to_external_number: string
  metadata?: JsonObject
}

export interface IoTCommandRequest {
  from_agent_id: string
  to_external_address: string
  payload: JsonObject
  metadata?: JsonObject
}

export interface Message {
  id: string
  tenant_id: string
  from_agent_id: string
  to_agent_id?: string
  from_address: string
  to_external_address: string
  channel_type: ChannelType
  payload: string | JsonObject
  created_at: string
  metadata: JsonObject
}

export interface SendMessageResult {
  message_id: string
  status: 'accepted' | 'simulated'
  adapter_id: string
  external_id?: string
}

export type PlaceCallResult = SendMessageResult
export type IoTCommandResult = SendMessageResult

export interface QcsEvent {
  id: string
  tenant_id: string
  source: 'qcs' | 'kernel' | 'external'
  type: string
  payload: JsonObject
  created_at: string
  routing_hint?: string
}

export interface QcsContext {
  tenant_id: string
  principal_id: string
  authorization?: unknown
}

export interface QcsIntent {
  operation: 'register_agent' | 'read_identity' | 'subscribe_events' | 'send_message' | 'place_call' | 'emit_iot_command' | 'receive_event'
  tenant_id: string
  principal_id: string
  body: JsonObject
}

export interface QcsAuthority {
  authorizeAndConsume(intent: Readonly<QcsIntent>, context: Readonly<QcsContext>): Promise<void>
}

export interface QcsAuditRecord {
  id: string
  tenant_id: string
  principal_id: string
  operation: QcsIntent['operation']
  intent_digest: string
  status: 'attempt' | 'refused' | 'accepted' | 'simulated' | 'failed'
  created_at: string
}

export interface QcsAdapter {
  readonly id: string
  readonly channels: readonly ChannelType[]
  send(message: Readonly<Message>): Promise<{ status: 'accepted' | 'simulated'; external_id?: string }>
}

export type UnsubscribeFn = () => void
export type QcsEventHandler = (event: QcsEvent) => Promise<void>

export interface IncomingEventRequest {
  channel_type: ChannelType
  type: string
  payload: JsonObject
  routing_hint?: string
}

export interface BroadcastRequest {
  messages: SendMessageRequest[]
}

export interface BroadcastResult {
  results: SendMessageResult[]
}