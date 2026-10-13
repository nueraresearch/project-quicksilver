/**
 * GET /api/operator/queue — the operator's unified attention surface.
 *
 * Assembles four buckets from native Quicksilver records:
 *   needsDecision  — decisions in awaiting-approval or rollback-proposed
 *   needsAction    — i-owe commitments due soonest first
 *   waitingOnOthers — they-owe commitments past their checkBackAt date
 *   upcoming       — commitments due within the next 7 days (all directions)
 *
 * Pure read. No state changes. Needs decision:read permission.
 * Gracefully returns empty buckets when commitment documents don't exist yet.
 */

import { NextResponse } from 'next/server'
import { guardWebRoute } from '@/lib/route-guard'
import { getSanityClient } from '@/lib/sanity-client'

export const dynamic = 'force-dynamic'

const DECISIONS_QUERY = `*[_type == "decision" && status in ["awaiting-approval", "rollback-proposed"]]
  | order(coalesce(createdAt, _createdAt) desc)[0...50]{
  _id, question, selectedAction, status, riskLevel, requiredApproval, requestedBy, createdAt, kind
}`

const COMMITMENTS_QUERY = `*[_type == "commitment" && status == "open"]
  | order(coalesce(dueAt, createdAt, _createdAt) asc)[0...100]{
  _id, title, direction, dueAt, checkBackAt, context, createdAt,
  "counterpartyName": counterparty->name
}`

const SCHEDULED_ITEMS_QUERY = `*[_type == "scheduledItem" && status == "upcoming"]
  | order(startsAt asc)[0...100]{
  _id, title, kind, startsAt, endsAt, allDay, recurrence, notes,
  "counterpartyName": linkedContact->name
}`

interface DecisionRow {
  _id: string
  question?: string | null
  selectedAction?: string | null
  status?: string | null
  riskLevel?: number | null
  requiredApproval?: boolean | null
  requestedBy?: string | null
  createdAt?: string | null
  kind?: string | null
}

interface CommitmentRow {
  _id: string
  title?: string | null
  direction?: string | null
  dueAt?: string | null
  checkBackAt?: string | null
  context?: string | null
  createdAt?: string | null
  counterpartyName?: string | null
}

interface ScheduledItemRow {
  _id: string
  title?: string | null
  kind?: string | null
  startsAt?: string | null
  endsAt?: string | null
  allDay?: boolean | null
  recurrence?: string | null
  notes?: string | null
  counterpartyName?: string | null
}

function toDecisionItem(row: DecisionRow) {
  return {
    id: row._id,
    title: row.question?.trim() || row.selectedAction?.trim() || 'Untitled decision',
    status: row.status ?? 'awaiting-approval',
    riskLevel: row.riskLevel ?? null,
    requiredApproval: row.requiredApproval === true,
    requestedBy: row.requestedBy ?? null,
    kind: row.kind ?? null,
    createdAt: row.createdAt ?? null,
  }
}

function toCommitmentItem(row: CommitmentRow) {
  return {
    id: row._id,
    title: row.title ?? 'Untitled commitment',
    direction: row.direction ?? 'i-owe',
    dueAt: row.dueAt ?? null,
    checkBackAt: row.checkBackAt ?? null,
    context: row.context ?? null,
    counterpartyName: row.counterpartyName ?? null,
    createdAt: row.createdAt ?? null,
  }
}

function toScheduledUpcomingItem(row: ScheduledItemRow) {
  return {
    id: row._id,
    title: `[${(row.kind ?? 'reminder').toUpperCase()}] ${row.title ?? 'Untitled item'}`,
    direction: 'scheduled',
    dueAt: row.startsAt ?? null,
    counterpartyName: row.counterpartyName ?? null,
  }
}

/**
 * GET /api/operator/queue
 *
 * Returns { observedAt, buckets: { needsDecision[], needsAction[], waitingOnOthers[], upcoming[] }, counts }
 */
export async function GET(request: Request) {
  const caller = await guardWebRoute(request, 'decisions')
  if (!caller.ok) return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers })

  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    const empty = { needsDecision: [], needsAction: [], waitingOnOthers: [], upcoming: [] }
    return NextResponse.json({
      observedAt: new Date().toISOString(),
      buckets: empty,
      counts: { needsDecision: 0, needsAction: 0, waitingOnOthers: 0, upcoming: 0, total: 0 },
    }, { headers: { 'cache-control': 'no-store' } })
  }

  try {
    const client = getSanityClient('read')
    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    const nowIso = new Date(now).toISOString()
    const sevenDaysIso = new Date(now + sevenDaysMs).toISOString()

    const [decisionRows, commitmentRows, scheduledRows] = await Promise.all([
      client.fetch<DecisionRow[]>(DECISIONS_QUERY).then((r) => r ?? []).catch(() => [] as DecisionRow[]),
      client.fetch<CommitmentRow[]>(COMMITMENTS_QUERY).then((r) => r ?? []).catch(() => [] as CommitmentRow[]),
      client.fetch<ScheduledItemRow[]>(SCHEDULED_ITEMS_QUERY).then((r) => r ?? []).catch(() => [] as ScheduledItemRow[]),
    ])

    const needsDecision = decisionRows.map(toDecisionItem)

    // i-owe commitments sorted by dueAt ascending
    const needsAction = commitmentRows
      .filter((r) => r.direction === 'i-owe')
      .map(toCommitmentItem)

    // they-owe commitments whose checkBackAt has passed
    const waitingOnOthers = commitmentRows
      .filter((r) => r.direction === 'they-owe' && r.checkBackAt != null && r.checkBackAt <= nowIso)
      .map(toCommitmentItem)

    // all open commitments and scheduled items due within the next 7 days
    const upcomingCommitments = commitmentRows
      .filter((r) => r.dueAt != null && r.dueAt > nowIso && r.dueAt <= sevenDaysIso)
      .map(toCommitmentItem)

    const upcomingScheduled = scheduledRows
      .filter((r) => r.startsAt != null && r.startsAt >= nowIso && r.startsAt <= sevenDaysIso)
      .map(toScheduledUpcomingItem)

    const upcoming = [...upcomingCommitments, ...upcomingScheduled].sort((a, b) => {
      const aTime = a.dueAt ? new Date(a.dueAt).getTime() : 0
      const bTime = b.dueAt ? new Date(b.dueAt).getTime() : 0
      return aTime - bTime
    })

    const counts = {
      needsDecision: needsDecision.length,
      needsAction: needsAction.length,
      waitingOnOthers: waitingOnOthers.length,
      upcoming: upcoming.length,
      total: needsDecision.length + needsAction.length + waitingOnOthers.length,
    }

    return NextResponse.json({
      observedAt: new Date().toISOString(),
      buckets: { needsDecision, needsAction, waitingOnOthers, upcoming },
      counts,
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[operator/queue] failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json(
      { error: 'Could not load the operator queue. Check the configured Quicksilver read data source.', code: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
