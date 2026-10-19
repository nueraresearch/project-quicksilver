import type { ChannelType, Message, QcsAdapter } from '../interfaces/types.ts'
import { snapshot } from '../core/config.ts'

export class DummyAdapter implements QcsAdapter {
  readonly id = 'dummy'
  readonly channels: readonly ChannelType[] = ['voice', 'sms', 'email', 'signal', 'iot']
  readonly messages: Message[] = []

  async send(message: Readonly<Message>): Promise<{ status: 'simulated' }> {
    this.messages.push(snapshot(message))
    return { status: 'simulated' }
  }
}