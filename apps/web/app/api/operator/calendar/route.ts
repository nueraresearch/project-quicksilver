/**
 * GET & POST /api/operator/calendar — operator in-app calendar.
 *
 * GET: Lists scheduled items for the operator. Filterable by `from`, `to`, `kind`, `status`.
 * POST: Proposes / records a new scheduled item. Validates kind, startsAt/endsAt, and recurrence cron.
 *
 * All operations fail closed without authentication.
 * Uses decision:read for GET, decision:propose for POST.
 */

import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { guardWebRoute, takeWebRateLimit } from '@/lib/route-guard'
import { getSanityClient } from '@/lib/sanity-client'
import {
  validateScheduledItem,
  filterCalendarItems,
  type ScheduledItem,
  type ScheduledItemKind,
  type ScheduledItemStatus,
} from '@quicksilver/operator'

export const dynamic = 'force-dynamic'

interface ScheduledItemDoc {
  _id: string
  title?: string | null
  kind?: string | null
  startsAt?: string | null
  endsAt?: string | null
  allDay?: boolean | null
  recurrence?: string | null
  linkedCommitment?: { _ref?: string } | null
  linkedDecision?: { _ref?: string } | null
  linkedContact?: { _ref?: string } | null
  notes?: string | null
  status?: string | null
  createdBy?: string | null
  createdAt?: string | null
}

function toScheduledItem(doc: ScheduledItemDoc): ScheduledItem {
  return {
    id: doc._id,
    title: doc.title?.trim() || 'Untitled event',
    kind: (doc.kind as ScheduledItemKind) || 'reminder',
    startsAt: doc.startsAt || new Date().toISOString(),
    endsAt: doc.endsAt ?? null,
    allDay: doc.allDay === true,
    recurrence: doc.recurrence ?? null,
    linkedCommitmentId: doc.linkedCommitment?._ref ?? null,
    linkedDecisionId: doc.linkedDecision?._ref ?? null,
    linkedContactId: doc.linkedContact?._ref ?? null,
    notes: doc.notes ?? null,
    status: (doc.status as ScheduledItemStatus) || 'upcoming',
    createdBy: doc.createdBy ?? null,
    createdAt: doc.createdAt ?? null,
  }
}

/**
 * GET /api/operator/calendar
 */
export async function GET(request: Request) {
  const caller = await guardWebRoute(request, 'decisions')
  if (!caller.ok) return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers })

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined
  const kind = (searchParams.get('kind') as ScheduledItemKind) || undefined
  const status = (searchParams.get('status') as ScheduledItemStatus) || undefined

  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    return NextResponse.json({ items: [], count: 0 }, { headers: { 'cache-control': 'no-store' } })
  }

  try {
    const client = getSanityClient('read')
    const query = `*[_type == "scheduledItem"] | order(startsAt asc)[0...200]{
      _id, title, kind, startsAt, endsAt, allDay, recurrence,
      linkedCommitment, linkedDecision, linkedContact, notes, status, createdBy, createdAt
    }`

    const rows = await client.fetch<ScheduledItemDoc[]>(query).then((r) => r ?? []).catch(() => [] as ScheduledItemDoc[])
    const items = rows.map(toScheduledItem)
    const filtered = filterCalendarItems(items, { from, to, kind, status })

    return NextResponse.json(
      { items: filtered, count: filtered.length },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    console.error('[operator/calendar] GET failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json(
      { error: 'Could not load calendar items.', code: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}

/**
 * POST /api/operator/calendar
 */
export async function POST(request: Request) {
  const caller = await guardWebRoute(request, 'memory/write')
  if (!caller.ok) return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers })

  const limited = takeWebRateLimit('write', caller.principalId)
  if (limited) return NextResponse.json(limited.body, { status: limited.status, headers: limited.headers })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed JSON payload.', code: 'invalid_json' }, { status: 400 })
  }

  const validation = validateScheduledItem(body)
  if (!validation.valid) {
    return NextResponse.json(
      { error: `Validation failed: ${validation.errors.join(' ')}`, code: 'validation_error', details: validation.errors },
      { status: 400 },
    )
  }

  const itemId = `scheduled-${randomUUID()}`
  const now = new Date().toISOString()

  const doc: ScheduledItem = {
    id: itemId,
    title: String(body.title).trim(),
    kind: body.kind,
    startsAt: body.startsAt,
    endsAt: body.endsAt || null,
    allDay: body.allDay === true,
    recurrence: body.recurrence || null,
    linkedCommitmentId: body.linkedCommitmentId || null,
    linkedDecisionId: body.linkedDecisionId || null,
    linkedContactId: body.linkedContactId || null,
    notes: body.notes || null,
    status: body.status || 'upcoming',
    createdBy: caller.principalId,
    createdAt: now,
  }

  if (process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    try {
      const client = getSanityClient('write')
      await client.createIfNotExists({
        _id: itemId,
        _type: 'scheduledItem',
        title: doc.title,
        kind: doc.kind,
        startsAt: doc.startsAt,
        endsAt: doc.endsAt,
        allDay: doc.allDay,
        recurrence: doc.recurrence,
        linkedCommitment: doc.linkedCommitmentId ? { _type: 'reference', _ref: doc.linkedCommitmentId } : undefined,
        linkedDecision: doc.linkedDecisionId ? { _type: 'reference', _ref: doc.linkedDecisionId } : undefined,
        linkedContact: doc.linkedContactId ? { _type: 'reference', _ref: doc.linkedContactId } : undefined,
        notes: doc.notes,
        status: doc.status,
        createdBy: doc.createdBy,
        createdAt: doc.createdAt,
      })
    } catch (error) {
      console.error('[operator/calendar] POST write failed', error instanceof Error ? error.name : 'UnknownError')
      return NextResponse.json(
        { error: 'Failed to persist scheduled item.', code: 'write_failure' },
        { status: 503 },
      )
    }
  }

  return NextResponse.json({ item: doc }, { status: 201 })
}
