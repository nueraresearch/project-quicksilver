import type { Message, QcsAdapter } from '../interfaces/types.ts'

export interface SmtpSubmission {
  from: string
  to: string
  subject: string
  text: string
  idempotencyKey: string
}

export class SmtpAdapter implements QcsAdapter {
  readonly id = 'smtp'
  readonly channels = ['email'] as const
  private readonly submit: (message: SmtpSubmission) => Promise<{ messageId: string }>

  constructor(submit: (message: SmtpSubmission) => Promise<{ messageId: string }>) {
    this.submit = submit
  }

  async send(message: Readonly<Message>): Promise<{ status: 'accepted'; external_id: string }> {
    if (message.channel_type !== 'email') throw new Error('SMTP only supports email.')
    const text = typeof message.payload === 'string' ? message.payload : message.payload.text
    const subject = typeof message.payload === 'object' ? message.payload.subject : message.metadata.subject ?? 'Quicksilver'
    if (typeof text !== 'string' || typeof subject !== 'string' || !text.trim() || !subject.trim()) throw new Error('SMTP needs a text body and subject.')
    const result = await this.submit({ from: message.from_address, to: message.to_external_address, subject, text, idempotencyKey: `${message.tenant_id}:${message.id}` })
    return { status: 'accepted', external_id: result.messageId }
  }
}