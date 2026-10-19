import { createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { connect } from 'node:tls'

export interface SmtpOptions {
  host: string
  port?: number
  username: string
  password: string
}

export interface SmtpMessage {
  from: string
  to: string
  subject: string
  text: string
  idempotencyKey: string
}

export type SmtpConnector = (options: { host: string; port: number; servername: string; rejectUnauthorized: true }) => Duplex

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/

export function validateSmtpOptions(options: SmtpOptions): void {
  if (typeof options.host !== 'string' || !/^(?=.{1,253}$)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/.test(options.host)) throw new Error('SMTP needs a valid server hostname.')
  if (!Number.isInteger(options.port ?? 465) || (options.port ?? 465) < 1 || (options.port ?? 465) > 65535) throw new Error('SMTP needs a valid TLS port.')
  if (typeof options.username !== 'string' || !options.username || typeof options.password !== 'string' || !options.password || /[\u0000-\u001f\u007f]/.test(options.username + options.password)) throw new Error('SMTP needs a username and password without control characters.')
}

export async function sendSmtpMail(options: SmtpOptions, message: SmtpMessage, connector: SmtpConnector = connect): Promise<{ messageId: string }> {
  validateSmtpOptions(options)
  if (!ADDRESS.test(message.from) || !ADDRESS.test(message.to)) throw new Error('SMTP needs single mailbox addresses.')
  if (!message.subject.trim() || /[\u0000-\u001f\u007f]/.test(message.subject) || message.subject.length > 200 || !message.text.trim() || message.text.length > 5000) throw new Error('SMTP needs a valid subject and text body.')
  const messageId = `<${createHash('sha256').update(JSON.stringify([message.from, message.to, message.idempotencyKey])).digest('hex')}@quicksilver.local>`
  const socket = connector({ host: options.host, port: options.port ?? 465, servername: options.host, rejectUnauthorized: true })
  const timer = setTimeout(() => socket.destroy(new Error('SMTP timeout')), 10_000)
  let accepted = false
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', resolve)
      socket.once('error', reject)
      socket.once('close', () => reject(new Error('SMTP connection closed before TLS negotiation')))
    })
    const chunks = socket[Symbol.asyncIterator]()
    let pending = ''
    const reply = async (): Promise<{ code: number; lines: string[] }> => {
      const lines: string[] = []
      let code: number | undefined
      let bytes = 0
      while (true) {
        let end = pending.indexOf('\r\n')
        while (end < 0) {
          const chunk = await chunks.next()
          if (chunk.done) throw new Error('SMTP connection closed')
          pending += Buffer.from(chunk.value).toString('utf8')
          if (Buffer.byteLength(pending) + bytes > 64 * 1024) throw new Error('SMTP reply too large')
          end = pending.indexOf('\r\n')
        }
        const line = pending.slice(0, end)
        pending = pending.slice(end + 2)
        bytes += Buffer.byteLength(line) + 2
        if (bytes > 64 * 1024) throw new Error('SMTP reply too large')
        const match = /^(\d{3})([ -])(.*)$/.exec(line)
        if (!match || (code !== undefined && code !== Number(match[1]))) throw new Error('Invalid SMTP reply')
        code = Number(match[1])
        lines.push(match[3]!)
        if (match[2] === ' ') return { code, lines }
      }
    }
    const command = async (text: string, expected: number) => {
      socket.write(`${text}\r\n`)
      const response = await reply()
      if (response.code !== expected) throw new Error('SMTP command refused')
      return response
    }
    if ((await reply()).code !== 220) throw new Error('SMTP greeting refused')
    const greeting = await command('EHLO quicksilver.local', 250)
    const mechanisms = greeting.lines.filter((line) => /^AUTH[ =]/i.test(line)).flatMap((line) => line.slice(5).toUpperCase().split(/\s+/))
    if (!mechanisms.includes('PLAIN')) throw new Error('SMTP requires AUTH PLAIN over TLS')
    const auth = Buffer.from(`\0${options.username}\0${options.password}`).toString('base64')
    await command(`AUTH PLAIN ${auth}`, 235)
    await command(`MAIL FROM:<${message.from}>`, 250)
    await command(`RCPT TO:<${message.to}>`, 250)
    await command('DATA', 354)
    const body = Buffer.from(message.text).toString('base64').match(/.{1,76}/g)!.join('\r\n')
    const subjectParts: string[] = ['']
    for (const character of message.subject.trim()) {
      const last = subjectParts.length - 1
      if (Buffer.byteLength(subjectParts[last]! + character) > 42) subjectParts.push(character)
      else subjectParts[last] += character
    }
    const subject = subjectParts.map((part) => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ')
    const payload = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      body,
      '.',
    ].join('\r\n')
    await command(payload, 250)
    accepted = true
    socket.end('QUIT\r\n')
    return { messageId }
  } catch {
    if (accepted) return { messageId }
    throw new Error('SMTP submission failed. It may or may not have been accepted; check the mailbox before retrying.')
  } finally {
    clearTimeout(timer)
    socket.destroy()
  }
}