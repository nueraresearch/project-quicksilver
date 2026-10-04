/**
 * The checks behind `npm run demo:email-proof`: pure functions over what the Render host answered, so each can
 * be tested with a made-up answer. Nothing here reads a token or prints one.
 */
import type { Finding } from './demo-preflight.ts'

const pass = (text: string): Finding => ({ level: 'pass', text })
const fail = (text: string): Finding => ({ level: 'fail', text })

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

export const proposalOf = (body: unknown): Record<string, unknown> => asRecord(asRecord(body).proposal)

export function checkHealth(status: number, body: unknown): Finding[] {
  if (status === 0) return [fail('Host: could not reach it (no answer at all). Check the address and that the Render service is live.')]
  return status === 200 && asRecord(body).status === 'ok' ? [pass('Host: /healthz answers ok.')] : [fail(`Host: /healthz answered ${status}.`)]
}

export function checkPropose(status: number, body: unknown): { findings: Finding[]; id?: string } {
  if (status === 401) return { findings: [fail('Propose: the agent token was not accepted. Check QUICKSILVER_PRINCIPALS and the redeploy.')] }
  if (status !== 201) return { findings: [fail(`Propose: expected 201 but got ${status}${errorText(body)}.`)] }
  const p = proposalOf(body)
  const id = typeof p.id === 'string' ? p.id : undefined
  if (!id) return { findings: [fail('Propose: answered 201 without a proposal id.')] }
  if (asRecord(body).executed !== false) return { findings: [fail('Propose: the answer says the action already ran. A proposal must only record.')], id }
  return { findings: [pass(`Propose: the agent proposed ${id}; nothing was sent.`)], id }
}

export const checkAgentRefused = (status: number): Finding[] =>
  status === 403 ? [pass('Agent approve: refused with 403, as it must be.')] : [fail(`Agent approve: expected 403 but got ${status}. An agent must never be able to approve.`)]

export function checkApprove(status: number, body: unknown): Finding[] {
  if (status === 503) return [fail('Approve: 503. QUICKSILVER_AUTHORIZATION_KEY is missing or shorter than 32 characters.')]
  if (status !== 200) return [fail(`Approve: expected 200 but got ${status}${errorText(body)}.`)]
  const answer = asRecord(body)
  const p = proposalOf(body)
  if (p.status !== 'executed' || answer.executed !== true) return [fail(`Approve: the proposal ended as "${String(p.status)}", not executed${errorText(body)}.`)]
  if (answer.dryRun === true) return [fail('Approve: it ran as a DRY RUN, so no email was sent. The email block or QUICKSILVER_EMAIL_API_KEY is missing; the log should say "notification.send is LIVE".')]
  return [pass('Approve: a human approved it and it executed live. Check the inbox of your Resend account address.')]
}

export const checkReplay = (status: number): Finding[] =>
  status === 409 ? [pass('Replay: a second approval is refused with 409.')] : [fail(`Replay: expected 409 but got ${status}. A proposal must run once only.`)]

function errorText(body: unknown): string {
  const e = asRecord(body).error
  return typeof e === 'string' ? `: ${e.slice(0, 200)}` : ''
}
