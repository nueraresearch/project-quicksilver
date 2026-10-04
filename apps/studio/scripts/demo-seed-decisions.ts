/**
 * Put real decisions in front of a judge. Asks the demo deployment's own planner (POST /api/plan, as
 * the public demo requester, Marcus Webb) to plan a few objectives for the seed company. The decisions
 * it saves are genuine: drafted by the planner agent, checked by the kernel, read by the reviewer, with a
 * real explanation and fingerprint. A judge signs in as Sarah Chen and approves one in seconds, with no
 * wait for a model.
 *
 *   npm run demo:seed-decisions -- --base-url https://<demo site>              # dry run: lists what it would ask
 *   npm run demo:seed-decisions -- --base-url https://<demo site> --confirm    # does it
 *   ... --only skip-inspection        # one objective
 *
 * By default it uses only the public demo token, which a deployment accepts only in demo mode, so pointing
 * it at a production site fails with 401 and changes nothing. To seed a real site instead, ask as an agent:
 *
 *   npm run principal:token -- entity-engineering-agent --kind agent     # once; put the entry in QUICKSILVER_PRINCIPALS
 *   $env:QUICKSILVER_AGENT_TOKEN = "<the token it printed>"              # your own shell only
 *   npm run demo:seed-decisions -- --base-url https://<site> --token-env QUICKSILVER_AGENT_TOKEN --confirm
 *
 * The decisions then record the agent entity as the requester, so any human with the approval role can
 * approve them (a requester can never approve their own). It spends model calls on that deployment (one
 * plan per objective) and creates decisions there: run it once, not repeatedly.
 */
import { DEMO_PRINCIPALS } from '../../web/lib/demo-mode.ts'
import { DEMO_OBJECTIVES, validateDemoObjectives } from '../seed/demo-objectives.ts'
import { assertSafeBaseUrl, isWaitingForApproval, plannedDecisions, requesterFor } from '../lib/demo-decisions.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main(): Promise<void> {
  const problems = validateDemoObjectives()
  if (problems.length) throw new Error(`demo objectives are invalid:\n- ${problems.join('\n- ')}`)
  const raw = arg('--base-url')
  if (!raw) throw new Error('Pass --base-url https://<your demo site>')
  const base = assertSafeBaseUrl(raw)
  const confirm = process.argv.includes('--confirm')
  const only = arg('--only')
  const list = only ? DEMO_OBJECTIVES.filter((o) => o.id === only) : DEMO_OBJECTIVES
  if (!list.length) throw new Error(`No objective "${only}". Choices: ${DEMO_OBJECTIVES.map((o) => o.id).join(', ')}`)

  const demo = DEMO_PRINCIPALS.find((p) => p.id === 'entity-marcus-webb')
  if (!demo) throw new Error('The demo requester is missing from demo-mode.ts.')
  const requester = requesterFor(arg('--token-env'), process.env, demo)

  console.log(`Decisions for ${base.origin} as ${requester.label} (${confirm ? 'LIVE RUN' : 'DRY RUN, add --confirm'})\n`)
  let waiting = 0
  for (const item of list) {
    console.log(`- ${item.id}: ${item.shows}`)
    if (!confirm) continue
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch(new URL('/api/plan', base), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${requester.token}` },
        body: JSON.stringify({ objective: item.objective }),
      })
      const body: unknown = await response.json().catch(() => ({}))
      if (response.status === 429 && attempt < 4) {
        const wait = Number((body as { retryAfterSeconds?: unknown }).retryAfterSeconds)
        await sleep((Number.isFinite(wait) && wait > 0 ? wait : 10) * 1000)
        continue
      }
      if (!response.ok) {
        const reason = (body as { error?: unknown }).error
        console.log(`    FAILED (${response.status}): ${typeof reason === 'string' ? reason : 'no reason given'}`)
        break
      }
      const saved = plannedDecisions(body)
      if (!saved.length) console.log('    planned, but no decision was saved (an action could not be matched to company records)')
      for (const d of saved) {
        if (isWaitingForApproval(d)) waiting += 1
        console.log(`    ${d.decisionDocId}: ${d.safetyDecision ?? 'no verdict'}, ${d.status ?? 'no status'}: ${d.action}`)
      }
      break
    }
    await sleep(2_000)
  }
  if (!confirm) return
  console.log(`\n${waiting} decision${waiting === 1 ? '' : 's'} waiting for approval.`)
  if (waiting === 0) {
    console.log('None is waiting for approval. A model drafts each plan, so run again, or add --only for one objective.')
    process.exit(2)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Failed.')
  process.exit(1)
})
