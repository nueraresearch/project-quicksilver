/**
 * Operator Reviews API (Operator Organization Layer — Phase 3).
 *
 * GET  /api/operator/reviews — List recent operator reviews (or live preview when unpersisted).
 * POST /api/operator/reviews — Generate and persist a new review snapshot on demand.
 *
 * Guarded by decision:read (GET) and decision:propose (POST).
 */

import { NextResponse } from 'next/server'
import { guardWebRoute } from '@/lib/route-guard'
import { getSanityClient } from '@/lib/sanity-client'
import { assembleReview, type ReviewCadence, type ReviewData } from '../../../../../../packages/operator/src/review.ts'

export const dynamic = 'force-dynamic'

const REVIEWS_QUERY = `*[_type == "review"] | order(coalesce(generatedAt, _createdAt) desc)[0...20]{
  _id, title, cadence, periodStart, periodEnd, summary, highlights, metrics, generatedAt, generatedBy
}`

const DECISIONS_QUERY = `*[_type == "decision" && status in ["awaiting-approval", "rollback-proposed", "proposed"]]
  | order(coalesce(createdAt, _createdAt) desc)[0...50]{
  _id, question, selectedAction, status, riskLevel, createdAt
}`

const COMMITMENTS_QUERY = `*[_type == "commitment" && status == "open"]
  | order(coalesce(dueAt, createdAt, _createdAt) asc)[0...100]{
  _id, title, direction, dueAt, checkBackAt, context, createdAt,
  "counterpartyName": counterparty->name
}`

interface RawDecision {
  _id: string
  question?: string | null
  selectedAction?: string | null
  status?: string | null
  riskLevel?: number | null
  createdAt?: string | null
}

interface RawCommitment {
  _id: string
  title?: string | null
  direction?: string | null
  dueAt?: string | null
  checkBackAt?: string | null
  context?: string | null
  createdAt?: string | null
  counterpartyName?: string | null
}

/**
 * GET /api/operator/reviews
 */
export async function GET(request: Request) {
  const caller = await guardWebRoute(request, 'decisions')
  if (!caller.ok) return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers })

  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    const liveReview = assembleReview({ cadence: 'daily' })
    return NextResponse.json({
      observedAt: new Date().toISOString(),
      reviews: [{ ...liveReview, id: 'preview-daily' }],
    }, { headers: { 'cache-control': 'no-store' } })
  }

  try {
    const client = getSanityClient('read')
    const found = await client.fetch<Array<{
      _id: string
      title: string
      cadence: ReviewCadence
      periodStart: string
      periodEnd: string
      summary: string
      highlights: string[]
      metrics: {
        pendingDecisionsCount: number
        dueCommitmentsCount: number
        waitingOnOthersCount: number
        upcomingCount: number
        staleItemsCount: number
      }
      generatedAt: string
      generatedBy: string
    }>>(REVIEWS_QUERY)

    const reviews: ReviewData[] = (found ?? []).map((r) => ({
      id: r._id,
      title: r.title,
      cadence: r.cadence,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      summary: r.summary,
      highlights: r.highlights ?? [],
      metrics: r.metrics ?? {
        pendingDecisionsCount: 0,
        dueCommitmentsCount: 0,
        waitingOnOthersCount: 0,
        upcomingCount: 0,
        staleItemsCount: 0,
      },
      decisions: [],
      commitments: [],
      generatedAt: r.generatedAt,
      generatedBy: r.generatedBy,
    }))

    if (reviews.length === 0) {
      // Assemble a live preview review so the operator always has current perspective
      const [decisionRows, commitmentRows] = await Promise.all([
        client.fetch<RawDecision[]>(DECISIONS_QUERY).then((r) => r ?? []),
        client.fetch<RawCommitment[]>(COMMITMENTS_QUERY).then((r) => r ?? []),
      ])
      const live = assembleReview({ cadence: 'daily', decisions: decisionRows, commitments: commitmentRows })
      reviews.push({ ...live, id: 'preview-daily' })
    }

    return NextResponse.json({
      observedAt: new Date().toISOString(),
      reviews,
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[operator/reviews] get failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json(
      { error: 'Could not load operator reviews.', code: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}

/**
 * POST /api/operator/reviews — Generate and persist a review snapshot.
 */
export async function POST(request: Request) {
  const caller = await guardWebRoute(request, 'memory/write')
  if (!caller.ok) return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers })

  let body: { cadence?: ReviewCadence } = {}
  try {
    body = (await request.json()) as { cadence?: ReviewCadence }
  } catch {
    // Body is optional
  }

  const cadence: ReviewCadence = ['daily', 'weekly', 'stale-loops', 'approvals'].includes(body.cadence as ReviewCadence)
    ? (body.cadence as ReviewCadence)
    : 'daily'

  let decisionRows: RawDecision[] = []
  let commitmentRows: RawCommitment[] = []

  if (process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    try {
      const readClient = getSanityClient('read')
      ;[decisionRows, commitmentRows] = await Promise.all([
        readClient.fetch<RawDecision[]>(DECISIONS_QUERY).then((r) => r ?? []),
        readClient.fetch<RawCommitment[]>(COMMITMENTS_QUERY).then((r) => r ?? []),
      ])
    } catch {
      // Degrade gracefully
    }
  }

  const review = assembleReview({
    cadence,
    decisions: decisionRows,
    commitments: commitmentRows,
    generatedBy: caller.principalId,
  })

  let persistedId: string = `review-${Date.now()}`

  if (process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    try {
      const writeClient = getSanityClient('write')
      const doc = await writeClient.create({
        _type: 'review',
        title: review.title,
        cadence: review.cadence,
        periodStart: review.periodStart,
        periodEnd: review.periodEnd,
        summary: review.summary,
        highlights: review.highlights,
        metrics: review.metrics,
        generatedAt: review.generatedAt,
        generatedBy: review.generatedBy,
      })
      persistedId = doc._id
    } catch (error) {
      console.warn('[operator/reviews] persistence failed, returning in-memory snapshot', error instanceof Error ? error.message : 'UnknownError')
    }
  }

  return NextResponse.json({
    observedAt: new Date().toISOString(),
    review: { ...review, id: persistedId },
  }, { status: 201, headers: { 'cache-control': 'no-store' } })
}
