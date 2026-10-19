import type { ChannelType, Message, QcsAdapter } from '../interfaces/types.ts'

export class UnavailableAdapter implements QcsAdapter {
  readonly id: string
  readonly channels: readonly ChannelType[]

  constructor(id: string, channels: readonly ChannelType[]) {
    this.id = id
    this.channels = channels
  }

  async send(_message: Readonly<Message>): Promise<never> {
    throw new Error('QCS transport is not implemented or configured; nothing was sent.')
  }
}