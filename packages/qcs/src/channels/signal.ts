import type { QCS } from '../interfaces/qcs_api.ts'
import type { IncomingEventRequest, QcsContext, SendMessageRequest } from '../interfaces/types.ts'

export function sendSignal(qcs: QCS, request: Omit<SendMessageRequest, 'channel_type'>, context: QcsContext) {
  return qcs.sendMessage({ ...request, channel_type: 'signal' }, context)
}

export function handleIncomingSignal(qcs: QCS, request: Omit<IncomingEventRequest, 'channel_type'>, context: QcsContext) {
  return qcs.receiveEvent({ ...request, channel_type: 'signal' }, context)
}