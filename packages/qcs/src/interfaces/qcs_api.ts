import type {
  AgentIdentity, BroadcastRequest, BroadcastResult, IncomingEventRequest, IoTCommandRequest,
  IoTCommandResult, PlaceCallRequest, PlaceCallResult, QcsContext, QcsEvent,
  QcsEventHandler, SendMessageRequest, SendMessageResult, UnsubscribeFn,
} from './types.ts'

export interface QCS {
  sendMessage(request: SendMessageRequest, context: QcsContext): Promise<SendMessageResult>
  placeCall(request: PlaceCallRequest, context: QcsContext): Promise<PlaceCallResult>
  emitIoTCommand(request: IoTCommandRequest, context: QcsContext): Promise<IoTCommandResult>
  registerAgent(identity: AgentIdentity, context: QcsContext): Promise<void>
  getAgentIdentity(agentId: string, context: QcsContext): Promise<AgentIdentity | null>
  subscribeToEvents(handler: QcsEventHandler, context: QcsContext): Promise<UnsubscribeFn>
  receiveEvent(request: IncomingEventRequest, context: QcsContext): Promise<QcsEvent>
  broadcastMessage(request: BroadcastRequest, contexts: QcsContext[]): Promise<BroadcastResult>
}