import type { QCS } from '../interfaces/qcs_api.ts'
import type { IncomingEventRequest, PlaceCallRequest, QcsContext } from '../interfaces/types.ts'

export function placeCall(qcs: QCS, request: PlaceCallRequest, context: QcsContext) {
  return qcs.placeCall(request, context)
}

export function handleIncomingCall(qcs: QCS, request: Omit<IncomingEventRequest, 'channel_type'>, context: QcsContext) {
  return qcs.receiveEvent({ ...request, channel_type: 'voice' }, context)
}