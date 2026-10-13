/**
 * Review Engine (Operator Organization Layer — Phase 3).
 *
 * Deterministically assembles daily attention briefs, weekly syntheses,
 * and stale loop audits from native Quicksilver records (decisions, commitments, contacts).
 *
 * Models and external services never hold review authority — reviews are informational
 * snapshots of operational memory.
 */

export type ReviewCadence = 'daily' | 'weekly' | 'stale-loops' | 'approvals'

export interface ReviewMetrics {
  pendingDecisionsCount: number
  dueCommitmentsCount: number
  waitingOnOthersCount: number
  upcomingCount: number
  staleItemsCount: number
}

export interface ReviewDecisionRef {
  id: string
  title: string
  status: string
  riskLevel: number | null
  createdAt?: string | null
}

export interface ReviewCommitmentRef {
  id: string
  title: string
  direction: 'i-owe' | 'they-owe'
  dueAt?: string | null
  checkBackAt?: string | null
  counterpartyName?: string | null
  context?: string | null
  createdAt?: string | null
}

export interface ReviewData {
  id?: string
  title: string
  cadence: ReviewCadence
  periodStart: string
  periodEnd: string
  summary: string
  highlights: string[]
  metrics: ReviewMetrics
  decisions: ReviewDecisionRef[]
  commitments: ReviewCommitmentRef[]
  generatedAt: string
  generatedBy: string
}

export interface AssembleReviewInput {
  cadence?: ReviewCadence
  decisions?: Array<{
    _id: string
    question?: string | null
    selectedAction?: string | null
    status?: string | null
    riskLevel?: number | null
    createdAt?: string | null
  }>
  commitments?: Array<{
    _id: string
    title?: string | null
    direction?: string | null
    dueAt?: string | null
    checkBackAt?: string | null
    context?: string | null
    counterpartyName?: string | null
    createdAt?: string | null
  }>
  now?: number
  generatedBy?: string
}

/**
 * Deterministically assemble a review from raw decisions and commitments.
 * Pure function: model-free, credential-free, reproducible.
 */
export function assembleReview(input: AssembleReviewInput): ReviewData {
  const cadence = input.cadence ?? 'daily'
  const now = input.now ?? Date.now()
  const nowIso = new Date(now).toISOString()
  const generatedBy = input.generatedBy ?? 'system:review-engine'

  const decisions = (input.decisions ?? []).map((d) => ({
    id: d._id,
    title: d.question?.trim() || d.selectedAction?.trim() || 'Untitled decision',
    status: d.status ?? 'awaiting-approval',
    riskLevel: d.riskLevel ?? null,
    createdAt: d.createdAt ?? null,
  }))

  const commitments: ReviewCommitmentRef[] = (input.commitments ?? []).map((c) => ({
    id: c._id,
    title: c.title ?? 'Untitled commitment',
    direction: (c.direction === 'they-owe' ? 'they-owe' : 'i-owe') as 'i-owe' | 'they-owe',
    dueAt: c.dueAt ?? null,
    checkBackAt: c.checkBackAt ?? null,
    counterpartyName: c.counterpartyName ?? null,
    context: c.context ?? null,
    createdAt: c.createdAt ?? null,
  }))

  const pendingDecisions = decisions.filter((d) => d.status === 'awaiting-approval' || d.status === 'rollback-proposed')
  const dueCommitments = commitments.filter((c) => c.direction === 'i-owe' && (c.dueAt == null || c.dueAt <= nowIso))
  const waitingOnOthers = commitments.filter((c) => c.direction === 'they-owe' && c.checkBackAt != null && c.checkBackAt <= nowIso)
  const sevenDaysIso = new Date(now + 7 * 86_400_000).toISOString()
  const upcoming = commitments.filter((c) => c.dueAt != null && c.dueAt > nowIso && c.dueAt <= sevenDaysIso)

  // Stale items: commitments with checkBackAt or createdAt older than 14 days
  const fourteenDaysAgoIso = new Date(now - 14 * 86_400_000).toISOString()
  const stale = commitments.filter((c) => (c.checkBackAt && c.checkBackAt < fourteenDaysAgoIso) || (c.createdAt && c.createdAt < fourteenDaysAgoIso))

  const metrics: ReviewMetrics = {
    pendingDecisionsCount: pendingDecisions.length,
    dueCommitmentsCount: dueCommitments.length,
    waitingOnOthersCount: waitingOnOthers.length,
    upcomingCount: upcoming.length,
    staleItemsCount: stale.length,
  }

  const highlights: string[] = []
  if (pendingDecisions.length > 0) {
    highlights.push(`${pendingDecisions.length} decision(s) awaiting your authorization`)
  }
  if (dueCommitments.length > 0) {
    highlights.push(`${dueCommitments.length} commitment(s) currently due`)
  }
  if (waitingOnOthers.length > 0) {
    highlights.push(`${waitingOnOthers.length} external item(s) overdue for follow-up`)
  }
  if (stale.length > 0) {
    highlights.push(`${stale.length} open loop(s) dormant > 14 days`)
  }
  if (highlights.length === 0) {
    highlights.push('All operational commitments and approval queues are clear.')
  }

  let periodStart = new Date(now - 86_400_000).toISOString()
  let title = `Daily Attention Review — ${nowIso.slice(0, 10)}`

  if (cadence === 'weekly') {
    periodStart = new Date(now - 7 * 86_400_000).toISOString()
    title = `Weekly Synthesis Review — ${nowIso.slice(0, 10)}`
  } else if (cadence === 'stale-loops') {
    periodStart = new Date(now - 30 * 86_400_000).toISOString()
    title = `Stale Loops Audit — ${nowIso.slice(0, 10)}`
  } else if (cadence === 'approvals') {
    title = `Pending Approvals Brief — ${nowIso.slice(0, 10)}`
  }

  const summary = [
    `${title}.`,
    `${pendingDecisions.length} decision(s) pending, ${dueCommitments.length} action(s) due, and ${waitingOnOthers.length} delegation(s) waiting for replies.`,
    highlights.join('. ') + '.',
  ].join('\n\n')

  return {
    title,
    cadence,
    periodStart,
    periodEnd: nowIso,
    summary,
    highlights,
    metrics,
    decisions: pendingDecisions,
    commitments,
    generatedAt: nowIso,
    generatedBy,
  }
}

/** Formats a review for CLI terminal or push message display. */
export function formatReviewPlainText(review: ReviewData): string {
  const lines: string[] = [
    `=== ${review.title} ===`,
    `Generated: ${review.generatedAt} (${review.cadence})`,
    '',
    `Metrics:`,
    `  • Pending approvals: ${review.metrics.pendingDecisionsCount}`,
    `  • Actions due:       ${review.metrics.dueCommitmentsCount}`,
    `  • Waiting on others: ${review.metrics.waitingOnOthersCount}`,
    `  • Upcoming (7 days): ${review.metrics.upcomingCount}`,
    `  • Stale loops:       ${review.metrics.staleItemsCount}`,
    '',
    `Highlights:`,
    ...review.highlights.map((h) => `  • ${h}`),
  ]

  if (review.decisions.length > 0) {
    lines.push('', `Pending Decisions:`)
    for (const d of review.decisions) {
      lines.push(`  [${d.status.toUpperCase()}] ${d.title} (risk: ${d.riskLevel ?? 'unspecified'})`)
    }
  }

  const due = review.commitments.filter((c) => c.direction === 'i-owe' && (c.dueAt == null || c.dueAt <= review.generatedAt))
  if (due.length > 0) {
    lines.push('', `Actions Due:`)
    for (const c of due) {
      lines.push(`  • ${c.title}${c.counterpartyName ? ` (with ${c.counterpartyName})` : ''}`)
    }
  }

  const waiting = review.commitments.filter((c) => c.direction === 'they-owe' && c.checkBackAt != null && c.checkBackAt <= review.generatedAt)
  if (waiting.length > 0) {
    lines.push('', `Waiting on Counterparties:`)
    for (const c of waiting) {
      lines.push(`  • ${c.title}${c.counterpartyName ? ` — ${c.counterpartyName}` : ''} (check-back was ${c.checkBackAt?.slice(0, 10)})`)
    }
  }

  return lines.join('\n')
}
