/**
 * The checks behind `npm run demo:preflight`: pure functions over what the live site answered, so each can be
 * tested with a made-up answer. Nothing here reads a token or prints one; the script passes in only the
 * response status and body.
 */
import { auditDigestMatches, type DecisionAuditExport } from '../../web/lib/decision-audit.ts'

export type Level = 'pass' | 'warn' | 'fail'
export interface Finding { level: Level; text: string }

const pass = (text: string): Finding => ({ level: 'pass', text })
const warn = (text: string): Finding => ({ level: 'warn', text })
const fail = (text: string): Finding => ({ level: 'fail', text })

/** Permissions a judge token does not need for the walkthrough: worth knowing before the token is published. */
export const BROAD_PERMISSIONS: readonly string[] = ['decision:execute', 'decision:rollback', 'finance:read', 'workflow:publish', 'agent:publish', 'memory:approve', 'routing:approve', 'run:redrive', 'tenant:admin']

export interface WhoamiExpectation {
  label: string
  id: string
  kind: 'human' | 'agent' | 'service'
  must: readonly string[]
  mustNot: readonly string[]
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

const unreachable = (what: string): Finding => fail(`${what}: could not reach the site (no answer at all). Check the address, your connection, and that the site is deployed.`)

export function checkWhoami(status: number, body: unknown, expect: WhoamiExpectation): Finding[] {
  const name = expect.label
  if (status === 0) return [unreachable(name)]
  if (status === 401) return [fail(`${name}: the site did not accept this token. The entry is missing from QUICKSILVER_PRINCIPALS, the site was not redeployed after the change, or the token was mistyped.`)]
  if (status === 503) return [fail(`${name}: the site reports its principals are misconfigured. Check that QUICKSILVER_PRINCIPALS is valid JSON.`)]
  if (status !== 200) return [fail(`${name}: unexpected answer ${status} from /api/whoami.`)]
  const who = asRecord(body)
  const permissions = Array.isArray(who.permissions) ? who.permissions.filter((p): p is string => typeof p === 'string') : []
  const out: Finding[] = []
  if (who.principalId !== expect.id) out.push(fail(`${name}: expected ${expect.id} but the token belongs to ${String(who.principalId)}.`))
  if (who.kind !== expect.kind) out.push(fail(`${name}: expected a ${expect.kind} entity but got ${String(who.kind)}.`))
  if (permissions.length === 0) {
    out.push(fail(`${name}: the token is accepted but holds no permissions. The entry's tenantId almost certainly differs from QUICKSILVER_TENANT_ID on the site (it must equal it, or be "default" when that variable is unset).`))
    return out
  }
  for (const permission of expect.must) if (!permissions.includes(permission)) out.push(fail(`${name}: should hold ${permission} and does not.`))
  for (const permission of expect.mustNot) if (permissions.includes(permission)) out.push(fail(`${name}: must not hold ${permission}, but does.`))
  if (out.length === 0) out.push(pass(`${name}: ${expect.id} (${expect.kind}), tenant ${String(who.tenantId)}, ${permissions.length} permissions.`))
  const broad = BROAD_PERMISSIONS.filter((p) => permissions.includes(p))
  if (broad.length && expect.kind === 'human') out.push(warn(`${name}: also holds ${broad.join(', ')}. Anyone with this token can use them, so decide whether you are comfortable publishing it.`))
  return out
}

export interface WaitingSummary { waiting: number; firstWaitingId: string | null; findings: Finding[] }

/** `minWaiting` is how many waiting decisions you want in front of judges, since every approval uses one up. */
export function checkDecisions(status: number, body: unknown, options: { agentId?: string; minWaiting?: number } = {}): WaitingSummary {
  const minWaiting = options.minWaiting ?? 5
  if (status === 0) return { waiting: 0, firstWaitingId: null, findings: [unreachable('Decisions')] }
  if (status !== 200) return { waiting: 0, firstWaitingId: null, findings: [fail(`Decisions: /api/decisions answered ${status}.`)] }
  const data = asRecord(body)
  const counts = asRecord(data.counts)
  const decisions = Array.isArray(data.decisions) ? data.decisions.map(asRecord) : []
  const waitingRows = decisions.filter((d) => d.status === 'awaiting-approval')
  const waiting = typeof counts['awaiting-approval'] === 'number' ? (counts['awaiting-approval'] as number) : waitingRows.length
  const findings: Finding[] = []
  if (waiting === 0) findings.push(fail('Decisions: none is waiting for approval. Run the seeding command, then check again.'))
  else if (waiting < minWaiting) findings.push(warn(`Decisions: ${waiting} waiting. Each approval uses one up, so a few judges will empty this. Seed more (a re-run adds more).`))
  else findings.push(pass(`Decisions: ${waiting} waiting for approval.`))
  if (options.agentId && waitingRows.length) {
    const others = waitingRows.filter((d) => d.requestedBy !== options.agentId)
    if (others.length) findings.push(warn(`Decisions: ${others.length} of the waiting decisions were not requested by ${options.agentId}. If the judge requested one, they cannot approve it.`))
  }
  const first = waitingRows.find((d) => typeof d.id === 'string')
  return { waiting, firstWaitingId: typeof first?.id === 'string' ? first.id : null, findings }
}

export function checkAudit(status: number, body: unknown): Finding[] {
  if (status === 0) return [unreachable('Audit trail')]
  if (status === 403) return [fail('Audit trail: the judge token cannot export it (needs audit:read).')]
  if (status !== 200) return [fail(`Audit trail: the export answered ${status}.`)]
  const exported = asRecord(body)
  const integrity = asRecord(exported.integrity)
  if (exported.schema !== 'quicksilver.decision-audit/1' || typeof integrity.digest !== 'string') return [fail('Audit trail: the export is not in the expected format.')]
  if (!auditDigestMatches(exported as unknown as DecisionAuditExport)) return [fail('Audit trail: the digest does not match the decision it carries.')]
  return [pass('Audit trail: exports, and its digest matches the record.')]
}

export function checkChat(status: number, body: unknown): Finding[] {
  const data = asRecord(body)
  if (status === 0) return [unreachable('Chat')]
  if (status !== 200) {
    const detail = typeof data.detail === 'string' ? ` (${data.detail})` : ''
    return [fail(`Chat: answered ${status}${detail}. The model account or the Context endpoints may be unreachable from the site.`)]
  }
  const answer = typeof data.answer === 'string' ? data.answer.trim() : ''
  if (answer.length < 20) return [fail('Chat: answered, but the answer is empty or too short.')]
  const sources = Array.isArray(data.sources) ? data.sources.length : 0
  return sources === 0
    ? [warn('Chat: answered without reading any source. For the video, ask something about the company so "What I looked at" is not empty.')]
    : [pass(`Chat: answered, reading ${sources} source${sources === 1 ? '' : 's'}.`)]
}

export function checkDataset(status: number, body: unknown): Finding[] {
  if (status === 0) return [unreachable('Public dataset')]
  if (status === 401 || status === 403) return [fail('Public dataset: it is private. Judges cannot query it. Set it to public: npx sanity dataset visibility set demo public')]
  if (status === 404) return [fail('Public dataset: not found. Check the project id and the dataset name.')]
  if (status !== 200) return [fail(`Public dataset: the query answered ${status}.`)]
  const result = asRecord(body).result
  const rows = Array.isArray(result) ? result.length : 0
  return rows > 0 ? [pass(`Public dataset: answers without a token, ${rows} row${rows === 1 ? '' : 's'}.`)] : [fail('Public dataset: it answers but returned no rows. It may not be seeded.')]
}

export const hasFailure = (findings: readonly Finding[]): boolean => findings.some((f) => f.level === 'fail')
