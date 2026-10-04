/**
 * Prove the Render host's first real email: an agent proposes it, the agent is refused when it tries to approve,
 * a human approves, Resend delivers, and a second approval is refused. Prints PASS or FAIL per step and never a
 * token: tokens come from environment variables in your own shell. This SENDS ONE REAL EMAIL, so it needs --confirm.
 *
 *   $env:FOUNDER_TOKEN = "<founder token>"; $env:AGENT_TOKEN = "<agent token>"
 *   npm run demo:email-proof -- --host-url https://<service>.onrender.com --to <your Resend account email> --founder-env FOUNDER_TOKEN --agent-env AGENT_TOKEN --confirm
 *
 * Without --confirm it stops after checking the host is up and describes what it would do.
 */
import { assertSafeBaseUrl } from '../lib/demo-decisions.ts'
import { checkAgentRefused, checkApprove, checkHealth, checkPropose, checkReplay, proposalOf } from '../lib/email-proof.ts'
import { hasFailure, type Finding } from '../lib/demo-preflight.ts'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function tokenFrom(name: string | undefined, label: string): string {
  if (!name || !/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) throw new Error(`${label} must be an environment variable name such as FOUNDER_TOKEN.`)
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`The environment variable ${name} is not set. Set it in your own shell first.`)
  return value
}

async function call(url: URL, token: string | undefined, body?: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    return { status: response.status, body: await response.json().catch(() => ({})) }
  } catch {
    return { status: 0, body: {} }
  }
}

const show = (findings: Finding[]) => {
  for (const f of findings) console.log(`${f.level === 'pass' ? 'PASS' : 'FAIL'}  ${f.text}`)
}

async function main(): Promise<void> {
  const raw = arg('--host-url')
  const to = arg('--to')
  if (!raw || !to) throw new Error('Pass --host-url https://<service>.onrender.com and --to <the recipient on the allow-list>')
  const host = assertSafeBaseUrl(raw)
  const founder = tokenFrom(arg('--founder-env'), '--founder-env')
  const agent = tokenFrom(arg('--agent-env'), '--agent-env')
  const all: Finding[] = []

  const health = await call(new URL('/healthz', host), undefined)
  const healthFindings = checkHealth(health.status, health.body)
  show(healthFindings); all.push(...healthFindings)
  if (hasFailure(all)) process.exit(1)

  if (!process.argv.includes('--confirm')) {
    console.log(`\nDry run. With --confirm this would send ONE real email to ${to} through ${host.origin}. Add --confirm when ready.`)
    return
  }

  const proposed = await call(new URL('/api/actions/proposals', host), agent, {
    toolId: 'notification.send',
    input: { to, subject: 'Nuera Quicksilver: one approved email', text: 'An agent proposed this email. A human approved it. This is the audit trail, not a mailing list.' },
    reason: 'Prove the approval gate end to end with one real email to the account owner.',
    evidence: ['demo:email-proof run', 'recipient is on the allow-list'],
  })
  const proposal = checkPropose(proposed.status, proposed.body)
  show(proposal.findings); all.push(...proposal.findings)
  if (!proposal.id) process.exit(1)

  const approve = new URL(`/api/actions/proposals/${encodeURIComponent(proposal.id)}/approve`, host)
  const refused = await call(approve, agent, {})
  const refusedFindings = checkAgentRefused(refused.status)
  show(refusedFindings); all.push(...refusedFindings)

  const approved = await call(approve, founder, { note: 'Approved by the founder after reading the proposal.' })
  const approvedFindings = checkApprove(approved.status, approved.body)
  show(approvedFindings); all.push(...approvedFindings)

  const replay = await call(approve, founder, {})
  const replayFindings = checkReplay(replay.status)
  show(replayFindings); all.push(...replayFindings)

  const record = proposalOf((await call(new URL(`/api/actions/proposals/${encodeURIComponent(proposal.id)}`, host), founder)).body)
  console.log(`\nProposal ${proposal.id}: status ${String(record.status)}. Keep this id; it is the evidence.`)
  if (hasFailure(all)) process.exit(1)
  console.log('All steps passed. Now check the inbox, and Resend\'s log, for the email.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
