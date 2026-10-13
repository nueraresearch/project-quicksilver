/**
 * Run the Operator from a terminal.
 *
 *   npm run operator -- "Add a /health route and a test for it" \
 *     --workspace ./sandbox --verify "npm test" --mode guarded --sandbox local
 *
 * Options:
 *   --workspace <dir>   where the agent works (created if missing); default ./operator-workspace
 *   --verify <cmd>      a command the runtime runs after the agent finishes (repeatable)
 *   --mode <m>          manual | guarded (default) | trusted
 *   --sandbox <s>       local (default) | docker
 *   --network           docker only: allow network access
 *   --max-steps <n>     model steps (default 40)
 *   --rollback <runId>  undo every file change a run made, then exit
 *   --memory review     confirm or reject profile entries the agent proposed, then exit
 *   --memory export --memory-file <path>  export a verified plaintext backup (never overwrites)
 *   --memory restore --memory-file <path> restore a verified backup into an empty memory book
 *   --memory feedback --memory-id <id> --outcome useful|stale|harmful
 *   --remember "<fact>" add a fact about you (stated), then exit
 *   --skills review     accept or reject skills the agent proposed (shows the diff), then exit
 *   --skills import <dir>  scan a skill folder (for example from a hub) and hold it for review
 *   --learn <runId>     have the agent turn a finished run into a skill proposal
 *   --queue             display the operator attention queue, then exit
 *   --review [cadence]  generate and display an operational review (daily|weekly|stale-loops), then exit
 *
 * Skills (SKILL.md standard) live in ~/.quicksilver/skills (QUICKSILVER_SKILLS_DIR)
 * and in <workspace>/skills; the agent sees their names and loads one when it fits.
 *
 * Memory lives in <workspace>/.qs-memory: past runs (searchable by the agent
 * with recall), the agent's notes, and your profile. Project context files
 * (QUICKSILVER.md, AGENTS.md, CLAUDE.md) in the workspace are loaded as data.
 *
 * Calls that need a person are asked here (y/n). Interactive tool approvals
 * use NQC_SUPERVISOR_ID (or QUICKSILVER_OPERATOR_APPROVER). Sensitive memory
 * management commands require QUICKSILVER_OPERATOR_TOKEN and a human principal
 * with memory:approve in QUICKSILVER_PRINCIPALS. The model is the agent
 * package's `executor` role (see packages/agent/src/models.ts).
 * The audit log is <workspace>/.qs-audit/operator.jsonl.
 */
import { createInterface } from 'node:readline/promises'
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'

import { loadRepoEnv } from '@quicksilver/agent/decision-predictor'
import { modelForRole } from '@quicksilver/agent/models'
import { AccessController } from '@quicksilver/kernel/identity'
import { StaticTokenIdentityProvider, principalsFromJson } from '@quicksilver/kernel/identity/tokens'

import { aiSdkDriver } from './ai-driver.ts'
import { FileAuditSink, verifyAudit } from './audit.ts'
import { FileCheckpointStore } from './checkpoints.ts'
import { Gate, type Approver } from './gate.ts'
import { runOperator } from './loop.ts'
import { loadProjectContext, MemoryBook, memoryTools, SessionArchive, type MemoryEffectivenessOutcome, type MemoryExportBundle } from './memory.ts'
import { assembleReview, formatReviewPlainText, type ReviewCadence } from './review.ts'
import { formatCalendarPlainText, type ScheduledItem } from './calendar.ts'
import { lineDiff, SkillLibrary, skillTools } from './skills.ts'
import { configuredWebSearchTools } from './web-search.ts'
import { homedir } from 'node:os'
import { DockerSandbox } from './sandbox/docker.ts'
import { LocalSandbox } from './sandbox/local.ts'
import { EXEC_TOOLS } from './tools/exec.ts'
import { ensureWorkspace, FILE_TOOLS } from './tools/files.ts'
import type { ApprovalMode, Sandbox } from './types.ts'

loadRepoEnv()

/** Human authorization is verified from a bearer token and audited before a sensitive memory operation. */
async function authorizeMemoryOperation(operation: string): Promise<string> {
  let principal: ReturnType<StaticTokenIdentityProvider['authenticate']>
  let misconfigured = false
  try {
    const provider = new StaticTokenIdentityProvider(principalsFromJson(process.env.QUICKSILVER_PRINCIPALS))
    principal = provider.authenticate(process.env.QUICKSILVER_OPERATOR_TOKEN)
  } catch {
    misconfigured = true
  }
  const tenantId = process.env.QUICKSILVER_TENANT_ID?.trim() || 'default'
  const access = new AccessController()
  const authorization = access.authorize(principal, 'memory:approve', { tenantId, kind: 'operator-memory', id: operation })
  const decision = misconfigured
    ? { ...authorization, allowed: false, grantedBy: [], reasons: [...authorization.reasons, 'Principal configuration is invalid.'] }
    : authorization
  try {
    await new FileAuditSink(join(workspace, '.qs-audit', 'operator.jsonl')).append({
      runId: `memory-auth-${randomUUID()}`,
      kind: 'approval',
      at: new Date(decision.at).toISOString(),
      data: { event: 'memory.authorization', operation, decision },
    })
  } catch {
    throw new Error('Memory access audit persistence failed; operation denied.')
  }
  if (!decision.allowed || principal?.kind !== 'human') throw new Error(`Memory operation denied: ${decision.reasons.join(' ') || 'a human principal is required.'}`)
  return principal.id
}

function args(argv: string[]) {
  const out: { goal: string[]; verify: string[]; [k: string]: string | string[] | boolean | undefined } = { goal: [], verify: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--verify') out.verify.push(argv[++i] ?? '')
    else if (a === '--network' || a === '--queue' || a === '--calendar') out[a.slice(2)] = true
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i]
    else out.goal.push(a)
  }
  return out
}

interface QueueBucketItem {
  id: string
  title: string
  status?: string | null
  riskLevel?: number | null
  direction?: string | null
  dueAt?: string | null
  checkBackAt?: string | null
  context?: string | null
  counterpartyName?: string | null
  createdAt?: string | null
}

interface QueueResponse {
  observedAt: string
  buckets: {
    needsDecision: QueueBucketItem[]
    needsAction: QueueBucketItem[]
    waitingOnOthers: QueueBucketItem[]
    upcoming: QueueBucketItem[]
  }
  counts: {
    needsDecision: number
    needsAction: number
    waitingOnOthers: number
    upcoming: number
    total: number
  }
}

async function displayOperatorQueue(): Promise<void> {
  const apiUrl = (process.env.QUICKSILVER_API_URL || 'http://localhost:3000').replace(/\/$/, '')
  const token = process.env.QUICKSILVER_OPERATOR_TOKEN
  let queueData: QueueResponse | null = null

  try {
    const res = await fetch(`${apiUrl}/api/operator/queue`, {
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    })
    if (res.ok) {
      queueData = (await res.json()) as QueueResponse
    }
  } catch {
    // API not reachable
  }

  if (!queueData && process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
    const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
    const readToken = process.env.SANITY_READ_TOKEN || process.env.SANITY_AUTH_TOKEN
    const query = `{
      "decisions": *[_type == "decision" && status in ["awaiting-approval", "rollback-proposed"]] | order(coalesce(createdAt, _createdAt) desc)[0...50]{ _id, question, selectedAction, status, riskLevel, requiredApproval, requestedBy, createdAt, kind },
      "commitments": *[_type == "commitment" && status == "open"] | order(coalesce(dueAt, createdAt, _createdAt) asc)[0...100]{ _id, title, direction, dueAt, checkBackAt, context, createdAt, "counterpartyName": counterparty->name }
    }`
    try {
      const url = `https://${projectId}.api.sanity.io/v2024-10-01/data/query/${dataset}?query=${encodeURIComponent(query)}`
      const res = await fetch(url, {
        headers: readToken ? { authorization: `Bearer ${readToken}` } : {},
      })
      if (res.ok) {
        const body = (await res.json()) as { result?: { decisions?: any[]; commitments?: any[] } }
        const decisions = body.result?.decisions || []
        const commitments = body.result?.commitments || []
        const nowIso = new Date().toISOString()
        const sevenDaysIso = new Date(Date.now() + 7 * 86400000).toISOString()
        const needsDecision = decisions.map((d: any) => ({
          id: d._id,
          title: d.question?.trim() || d.selectedAction?.trim() || 'Untitled decision',
          status: d.status,
          riskLevel: d.riskLevel,
          createdAt: d.createdAt,
        }))
        const needsAction = commitments.filter((c: any) => c.direction === 'i-owe').map((c: any) => ({
          id: c._id,
          title: c.title,
          direction: c.direction,
          dueAt: c.dueAt,
          checkBackAt: c.checkBackAt,
          context: c.context,
          counterpartyName: c.counterpartyName,
          createdAt: c.createdAt,
        }))
        const waitingOnOthers = commitments.filter((c: any) => c.direction === 'they-owe' && c.checkBackAt && c.checkBackAt <= nowIso).map((c: any) => ({
          id: c._id,
          title: c.title,
          direction: c.direction,
          dueAt: c.dueAt,
          checkBackAt: c.checkBackAt,
          context: c.context,
          counterpartyName: c.counterpartyName,
          createdAt: c.createdAt,
        }))
        const upcoming = commitments.filter((c: any) => c.dueAt && c.dueAt > nowIso && c.dueAt <= sevenDaysIso).map((c: any) => ({
          id: c._id,
          title: c.title,
          direction: c.direction,
          dueAt: c.dueAt,
          counterpartyName: c.counterpartyName,
          createdAt: c.createdAt,
        }))
        queueData = {
          observedAt: nowIso,
          buckets: { needsDecision, needsAction, waitingOnOthers, upcoming },
          counts: {
            needsDecision: needsDecision.length,
            needsAction: needsAction.length,
            waitingOnOthers: waitingOnOthers.length,
            upcoming: upcoming.length,
            total: needsDecision.length + needsAction.length + waitingOnOthers.length,
          },
        }
      }
    } catch {
      // Direct query fallback failed
    }
  }

  console.log('\n=== Quicksilver Operator Queue ===\n')

  if (!queueData) {
    console.log('Nothing needs your attention right now. Commitments, pending approvals, and follow-ups will appear here.\n')
    return
  }

  const { buckets, counts } = queueData
  const total = (counts?.needsDecision ?? 0) + (counts?.needsAction ?? 0) + (counts?.waitingOnOthers ?? 0)

  if (total === 0 && (counts?.upcoming ?? 0) === 0) {
    console.log('Nothing needs your attention right now. Commitments, pending approvals, and follow-ups will appear here.\n')
    return
  }

  if (buckets.needsDecision?.length > 0) {
    console.log(`=== Needs my decision (${buckets.needsDecision.length}) ===`)
    for (const item of buckets.needsDecision) {
      console.log(`• [${(item.status || 'review').toUpperCase()}] ${item.title}`)
      console.log(`  → status: ${item.status} · risk: ${item.riskLevel ?? 'unspecified'}${item.createdAt ? ` · ${item.createdAt}` : ''}`)
    }
    console.log('')
  }

  if (buckets.needsAction?.length > 0) {
    console.log(`=== Needs my action (${buckets.needsAction.length}) ===`)
    for (const item of buckets.needsAction) {
      console.log(`• ${item.title}${item.dueAt ? ` — due ${item.dueAt.slice(0, 10)}` : ''}`)
      if (item.counterpartyName || item.context) {
        console.log(`  → ${item.counterpartyName ? `with ${item.counterpartyName} · ` : ''}${item.context ? `context: "${item.context.slice(0, 80)}"` : ''}`)
      }
    }
    console.log('')
  }

  if (buckets.waitingOnOthers?.length > 0) {
    console.log(`=== Waiting on others (${buckets.waitingOnOthers.length}) ===`)
    for (const item of buckets.waitingOnOthers) {
      console.log(`• ${item.title}`)
      console.log(`  → ${item.counterpartyName ? `counterparty: ${item.counterpartyName} · ` : ''}check-back was ${item.checkBackAt ? item.checkBackAt.slice(0, 10) : 'scheduled'}`)
    }
    console.log('')
  }

  if (buckets.upcoming?.length > 0) {
    console.log(`=== Scheduled / upcoming (${buckets.upcoming.length}) ===`)
    for (const item of buckets.upcoming) {
      console.log(`• ${item.title}${item.dueAt ? ` — due ${item.dueAt.slice(0, 10)}` : ''}`)
      if (item.counterpartyName) console.log(`  → ${item.counterpartyName}`)
    }
    console.log('')
  }
}

async function displayOperatorReview(cadenceArg?: string | boolean): Promise<void> {
  const chosen = typeof cadenceArg === 'string' ? cadenceArg : 'daily'
  const cadence: ReviewCadence = ['daily', 'weekly', 'stale-loops', 'approvals'].includes(chosen)
    ? (chosen as ReviewCadence)
    : 'daily'

  const apiUrl = (process.env.QUICKSILVER_API_URL || 'http://localhost:3000').replace(/\/$/, '')
  const token = process.env.QUICKSILVER_OPERATOR_TOKEN
  let reviewData: any = null

  try {
    const res = await fetch(`${apiUrl}/api/operator/reviews`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ cadence }),
    })
    if (res.ok) {
      const body = (await res.json()) as { review?: any }
      if (body.review) reviewData = body.review
    }
  } catch {
    // API not reachable
  }

  if (!reviewData && process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
    const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
    const readToken = process.env.SANITY_READ_TOKEN || process.env.SANITY_AUTH_TOKEN
    const query = `{
      "decisions": *[_type == "decision" && status in ["awaiting-approval", "rollback-proposed"]] | order(coalesce(createdAt, _createdAt) desc)[0...50]{ _id, question, selectedAction, status, riskLevel, createdAt },
      "commitments": *[_type == "commitment" && status == "open"] | order(coalesce(dueAt, createdAt, _createdAt) asc)[0...100]{ _id, title, direction, dueAt, checkBackAt, context, createdAt, "counterpartyName": counterparty->name }
    }`
    try {
      const url = `https://${projectId}.api.sanity.io/v2024-10-01/data/query/${dataset}?query=${encodeURIComponent(query)}`
      const res = await fetch(url, { headers: readToken ? { authorization: `Bearer ${readToken}` } : {} })
      if (res.ok) {
        const body = (await res.json()) as { result?: { decisions?: any[]; commitments?: any[] } }
        reviewData = assembleReview({
          cadence,
          decisions: body.result?.decisions,
          commitments: body.result?.commitments,
          generatedBy: 'cli:operator',
        })
      }
    } catch {
      // Direct query fallback failed
    }
  }

  if (!reviewData) {
    reviewData = assembleReview({ cadence, generatedBy: 'cli:operator' })
  }

  console.log('\n' + formatReviewPlainText(reviewData) + '\n')
}

async function displayOperatorCalendar(): Promise<void> {
  const apiUrl = (process.env.QUICKSILVER_API_URL || 'http://localhost:3000').replace(/\/$/, '')
  const token = process.env.QUICKSILVER_OPERATOR_TOKEN
  let items: ScheduledItem[] = []

  try {
    const res = await fetch(`${apiUrl}/api/operator/calendar`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
    if (res.ok) {
      const body = (await res.json()) as { items?: ScheduledItem[] }
      if (Array.isArray(body.items)) items = body.items
    }
  } catch {
    // API not reachable
  }

  if (items.length === 0 && process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
    const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
    const readToken = process.env.SANITY_READ_TOKEN || process.env.SANITY_AUTH_TOKEN
    const query = `*[_type == "scheduledItem"] | order(startsAt asc)[0...100]{
      _id, title, kind, startsAt, endsAt, allDay, recurrence, notes, status, createdBy, createdAt
    }`
    try {
      const url = `https://${projectId}.api.sanity.io/v2024-10-01/data/query/${dataset}?query=${encodeURIComponent(query)}`
      const res = await fetch(url, { headers: readToken ? { authorization: `Bearer ${readToken}` } : {} })
      if (res.ok) {
        const body = (await res.json()) as { result?: any[] }
        items = (body.result ?? []).map((d: any) => ({
          id: d._id,
          title: d.title || 'Untitled item',
          kind: d.kind || 'reminder',
          startsAt: d.startsAt || new Date().toISOString(),
          endsAt: d.endsAt,
          allDay: d.allDay === true,
          recurrence: d.recurrence,
          notes: d.notes,
          status: d.status || 'upcoming',
          createdBy: d.createdBy,
          createdAt: d.createdAt,
        }))
      }
    } catch {
      // Direct query fallback failed
    }
  }

  console.log('\n' + formatCalendarPlainText(items) + '\n')
}

const o = args(process.argv.slice(2))

if (o.queue || o.goal[0] === 'queue') {
  await displayOperatorQueue()
  process.exit(0)
}

if (o.review || o.goal[0] === 'review') {
  const chosenCadence = typeof o.review === 'string' ? o.review : (typeof o.goal[1] === 'string' ? o.goal[1] : undefined)
  await displayOperatorReview(chosenCadence)
  process.exit(0)
}

if (o.calendar || o.goal[0] === 'calendar') {
  await displayOperatorCalendar()
  process.exit(0)
}

const root = process.env.INIT_CWD ?? process.cwd()
const workspace = await ensureWorkspace(join(root, String(o.workspace ?? 'operator-workspace')))
const checkpoints = new FileCheckpointStore(workspace)

if (o.rollback) {
  const restored = await checkpoints.rollback(String(o.rollback))
  console.log(restored.length ? `Restored ${restored.length} file(s):\n  ${restored.join('\n  ')}` : 'Nothing to restore for that run.')
  process.exit(0)
}

const book = new MemoryBook(join(workspace, '.qs-memory', 'memory.json'))
const archive = new SessionArchive(join(workspace, '.qs-memory'))
const approverId = process.env.QUICKSILVER_OPERATOR_APPROVER || process.env.NQC_SUPERVISOR_ID || 'local-human'

if (o.remember) {
  const principalId = await authorizeMemoryOperation('remember')
  const e = await book.addStated('user', String(o.remember), principalId)
  console.log(`Remembered (${e.id}).`)
  process.exit(0)
}
if (o.memory === 'review') {
  const reviewerId = await authorizeMemoryOperation('review')
  const pending = (await book.all()).filter((e) => e.status === 'pending')
  if (!pending.length) { console.log('Nothing waiting for review.'); process.exit(0) }
  const r = createInterface({ input: process.stdin, output: process.stdout })
  for (const e of pending) {
    const a = (await r.question(`The agent thinks: "${e.text}" (run ${e.source.runId ?? '?'}). Keep it? (y/N) `)).trim().toLowerCase()
    await book.review(e.id, a === 'y' || a === 'yes', reviewerId)
  }
  r.close()
  process.exit(0)
}
if (o.memory === 'feedback') {
  const reviewerId = await authorizeMemoryOperation('feedback')
  const id = String(o['memory-id'] ?? '')
  const outcome = String(o.outcome ?? '') as MemoryEffectivenessOutcome
  if (!id || !['useful', 'stale', 'harmful'].includes(outcome)) throw new Error('Usage: --memory feedback --memory-id <id> --outcome useful|stale|harmful')
  if (!await book.recordEffectiveness(id, outcome, reviewerId)) throw new Error(`Feedback was not recorded for active memory "${id}". Check the id, reviewer, and whether this version already has feedback.`)
  console.log(`Recorded ${outcome} feedback for ${id}.`)
  process.exit(0)
}
if (o.memory === 'export') {
  await authorizeMemoryOperation('export')
  const file = String(o['memory-file'] ?? '')
  if (!file) throw new Error('Usage: --memory export --memory-file <path>. The backup contains plaintext memory.')
  const target = resolve(root, file)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(await book.exportData(), null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await link(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
  console.log(`Exported memory backup to ${target}. Protect it as sensitive plaintext.`)
  process.exit(0)
}
if (o.memory === 'restore') {
  const reviewerId = await authorizeMemoryOperation('restore')
  const file = String(o['memory-file'] ?? '')
  if (!file) throw new Error('Usage: --memory restore --memory-file <path>.')
  const bundle = JSON.parse(await readFile(resolve(root, file), 'utf8')) as MemoryExportBundle
  if (!await book.restore(bundle, reviewerId)) throw new Error('Restore requires an empty memory book; existing entries were left unchanged.')
  console.log(`Restored verified memory into ${join(workspace, '.qs-memory')}.`)
  process.exit(0)
}

const skills = new SkillLibrary(process.env.QUICKSILVER_SKILLS_DIR || join(homedir(), '.quicksilver', 'skills'), workspace)
if (o.skills === 'review') {
  const pending = await skills.pending()
  if (!pending.length) { console.log('No skills waiting for review.'); process.exit(0) }
  const r = createInterface({ input: process.stdin, output: process.stdout })
  for (const p of pending) {
    const current = await skills.get(p.name)
    console.log(`\n=== ${p.name}${current ? ' (revision)' : ' (new)'} — ${p.description}`)
    console.log(current ? lineDiff(current.body, p.body) : p.body)
    const a = (await r.question('Accept? (y/N) ')).trim().toLowerCase()
    await skills.review(p.name, a === 'y' || a === 'yes')
  }
  r.close()
  process.exit(0)
}
if (o.skills === 'import') {
  const dir = o.goal[0]
  if (!dir) { console.error('Usage: --skills import <folder>'); process.exit(1) }
  const r = await skills.importFolder(join(root, dir))
  console.log(r.ok ? `Held "${r.name}" for review (--skills review).${r.flags.length ? `\nFlags: ${r.flags.join(' ')}` : ''}` : `Refused: ${r.problems.join(' ')}`)
  process.exit(r.ok ? 0 : 1)
}
if (o.learn) {
  o.goal = [`Read run ${String(o.learn)} with read_run. If it solved something that will come up again, write a skill for it with propose_skill: when to use it, the steps that worked, the checks that proved it, and the mistakes to avoid. Then finish. If it is not worth a skill, finish and say why.`]
}

const goal = o.goal.join(' ').trim()
if (!goal) {
  console.error('Usage: npm run operator -- "<goal>" [--workspace dir] [--verify cmd] [--mode manual|guarded|trusted] [--sandbox local|docker]')
  process.exit(1)
}
const mode = (String(o.mode ?? 'guarded')) as ApprovalMode
if (!['manual', 'guarded', 'trusted'].includes(mode)) { console.error('--mode must be manual, guarded or trusted.'); process.exit(1) }
const sandbox: Sandbox = o.sandbox === 'docker' ? new DockerSandbox({ workspace, network: o.network === true }) : new LocalSandbox({ workspace })
const audit = new FileAuditSink(join(workspace, '.qs-audit', 'operator.jsonl'))
const rl = createInterface({ input: process.stdin, output: process.stdout })
const approver: Approver = async (r) => {
  console.log(`\n  ? Approval needed: ${r.summary}\n    ${r.reasons.join('\n    ')}`)
  const a = (await rl.question('    Run it? (y/N) ')).trim().toLowerCase()
  return { approved: a === 'y' || a === 'yes', by: approverId, callHash: r.callHash }
}

const project = await loadProjectContext(workspace)
for (const f of project.flagged) console.log(`  ! context line removed (it tried to change the agent's rules): ${f}`)
const instructions = [await book.snapshot(), await skills.listing(), project.text].filter(Boolean).join('\n\n')
const usedSkills: string[] = []

console.log(`Operator — ${mode} mode, ${sandbox.describe()}\nWorkspace: ${workspace}\n`)
const result = await runOperator({
  gate: new Gate([...FILE_TOOLS, ...EXEC_TOOLS, ...memoryTools(book, archive), ...skillTools(skills, usedSkills), ...configuredWebSearchTools()], { mode, workspace, audit }),
  sandbox,
  checkpoints,
  audit,
  workspace,
  model: aiSdkDriver(modelForRole('executor')),
  approver,
}, {
  goal,
  instructions,
  verify: o.verify.filter(Boolean),
  maxSteps: o['max-steps'] ? Number(o['max-steps']) : undefined,
  onEvent: (e) => {
    if (e.type === 'model' && e.text.trim()) console.log(`\n${e.text.trim()}`)
    if (e.type === 'gate' && e.verdict === 'refuse') console.log(`  ✗ refused: ${e.summary} — ${(e.reasons ?? []).join(' ')}`)
    if (e.type === 'tool') console.log(`  ${e.ok ? '✓' : '!'} ${e.tool}: ${e.output.split('\n')[0]}`)
    if (e.type === 'verify') console.log(`  ${e.ok ? '✓' : '✗'} verify: ${e.command}`)
  },
})
rl.close()
await archive.save(goal, result, result.messages)
await skills.recordOutcome(usedSkills, result.status)
if ((await skills.pending()).length) console.log(`\nA skill proposal waits for review: npm run operator -- --skills review`)
archive.close()
const waiting = (await book.all()).filter((e) => e.status === 'pending').length
if (waiting) console.log(`\n${waiting} thing(s) the agent learned about you wait for review: npm run operator -- --workspace ${String(o.workspace ?? 'operator-workspace')} --memory review`)

const chain = verifyAudit(await audit.read())
console.log(`\n${result.status.toUpperCase()} — ${result.summary}`)
for (const n of result.notes) console.log(`  · ${n}`)
console.log(`\nRun ${result.runId}: ${result.steps} steps, ${result.toolCalls} tool calls, ${result.usage.inputTokens + result.usage.outputTokens} tokens. Audit chain ${chain.valid ? 'intact' : 'BROKEN'}.`)
console.log(`Undo every file change: npm run operator -- --workspace ${String(o.workspace ?? 'operator-workspace')} --rollback ${result.runId}`)
process.exit(result.status === 'verified' || result.status === 'done-unverified' ? 0 : 2)
