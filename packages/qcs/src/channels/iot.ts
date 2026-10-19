import type { QCS } from '../interfaces/qcs_api.ts'
import type { IncomingEventRequest, IoTCommandRequest, QcsContext } from '../interfaces/types.ts'

export function emitIoTCommand(qcs: QCS, request: IoTCommandRequest, context: QcsContext) {
  return qcs.emitIoTCommand(request, context)
}

export function handleIoTEvent(qcs: QCS, request: Omit<IncomingEventRequest, 'channel_type'>, context: QcsContext) {
  return qcs.receiveEvent({ ...request, channel_type: 'iot' }, context)
}