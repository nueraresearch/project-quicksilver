/**
 * Check a live site is ready for judges, before you record and before you post. Asks the deployed app the
 * questions a judge's first minutes depend on and prints PASS, WARN or FAIL for each. It never prints a
 * token: tokens are read from environment variables you set in your own shell.
 *
 *   $env:JUDGE_TOKEN = "<the judge token>"
 *   $env:AGENT_TOKEN = "<the agent token>"            # optional: also checks the agent
 *   npm run demo:preflight -- --base-url https://project-quicksilver.vercel.app --judge-env JUDGE_TOKEN --agent-env AGENT_TOKEN
 *
 * Add --chat to ask the chat one question (one model call, so a little credit). Exits 1 if anything FAILs.
 */
import { assertSafeBaseUrl } from '../lib/demo-decisions.ts'
import { checkAudit, checkChat, checkDataset, checkDecisions, checkWhoami, hasFailure, type Finding } from '../lib/demo-preflight.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function tokenFrom(name: string | undefined, label: string): string | undefined {
  if (!name) return undefined
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) throw new Error(`${label} must be an environment variable name such as JUDGE_TOKEN.`)
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`The environment variable ${name} is not set. Set it in your own shell first.`)
  return value
}

async function call(url: URL, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) })
    const body: unknown = await response.json().catch(() => ({}))
    return { status: response.status, body }
  } catch {
    return { status: 0, body: {} }
  }
}

const show = (findings: Finding[]) => {
  for (const f of findings) console.log(`${f.level === 'pass' ? 'PASS' : f.level === 'warn' ? 'WARN' : 'FAIL'}  ${f.text}`)
}

async function main(): Promise<void> {
  const raw = arg('--base-url')
  if (!raw) throw new Error('Pass --base-url https://<your site>')
  const base = assertSafeBaseUrl(raw)
  const judge = tokenFrom(arg('--judge-env'), '--judge-env')
  if (!judge) throw new Error('Pass --judge-env NAME, the environment variable holding the judge token.')
  const agent = tokenFrom(arg('--agent-env'), '--agent-env')
  const judgeId = arg('--judge-id') ?? 'entity-sarah-chen'
  const agentId = arg('--agent-id') ?? 'entity-engineering-agent'
  const all: Finding[] = []
  const bearer = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } })
  console.log(`Preflight for ${base.origin}\n`)

  const who = await call(new URL('/api/whoami', base), bearer(judge))
  const judgeFindings = checkWhoami(who.status, who.body, {
    label: 'Judge token', id: judgeId, kind: 'human',
    must: ['decision:read', 'decision:approve', 'audit:read'], mustNot: [],
  })
  show(judgeFindings); all.push(...judgeFindings)

  if (agent) {
    const a = await call(new URL('/api/whoami', base), bearer(agent))
    const f = checkWhoami(a.status, a.body, { label: 'Agent token', id: agentId, kind: 'agent', must: ['decision:propose'], mustNot: ['decision:approve', 'decision:execute'] })
    show(f); all.push(...f)
  }

  if (!hasFailure(judgeFindings)) {
    const list = await call(new URL('/api/decisions?limit=50', base), bearer(judge))
    const summary = checkDecisions(list.status, list.body, { agentId })
    show(summary.findings); all.push(...summary.findings)
    if (summary.firstWaitingId) {
      const audit = await call(new URL(`/api/decisions/${encodeURIComponent(summary.firstWaitingId)}/audit`, base), bearer(judge))
      const f = checkAudit(audit.status, audit.body)
      show(f); all.push(...f)
    }
    if (process.argv.includes('--chat')) {
      const chat = await call(new URL('/api/chat', base), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${judge}` },
        body: JSON.stringify({ message: 'Which policies apply to changing a production parameter? Answer in two sentences.' }),
      })
      const f = checkChat(chat.status, chat.body)
      show(f); all.push(...f)
    } else console.log('SKIP  Chat: add --chat to ask it one question (one model call).')
  }

  const datasetUrl = new URL('https://f87t11g1.apicdn.sanity.io/v2024-10-01/data/query/demo')
  datasetUrl.searchParams.set('query', '*[_type=="policy"][0...3]{name}')
  const dataset = await call(datasetUrl)
  const f = checkDataset(dataset.status, dataset.body)
  show(f); all.push(...f)

  const failed = all.filter((x) => x.level === 'fail').length
  const warned = all.filter((x) => x.level === 'warn').length
  console.log(`\n${failed ? `${failed} check${failed === 1 ? '' : 's'} FAILED` : 'Ready'}${warned ? `, ${warned} warning${warned === 1 ? '' : 's'}` : ''}.`)
  if (failed) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Failed.')
  process.exit(1)
})
