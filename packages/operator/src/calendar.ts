/**
 * In-app Calendar Engine (Operator Organization Layer — Phase 4).
 *
 * Deterministically manages, filters, validates, and formats in-app scheduled items
 * (reminders, review blocks, meetings, deadlines, check-backs).
 *
 * External calendar tools (Google Calendar, iCal, Outlook) are sync targets only.
 * Quicksilver's scheduledItem records are the system of record.
 */

import { validateCron } from '@quicksilver/kernel/triggers/cron'

export type ScheduledItemKind = 'reminder' | 'review-block' | 'meeting' | 'deadline' | 'check-back'
export type ScheduledItemStatus = 'upcoming' | 'done' | 'cancelled'

export interface ExternalCalendarSync {
  provider: 'google' | 'ical' | 'outlook'
  externalId: string
  syncedAt: string
  etag?: string
}

export interface ScheduledItem {
  id: string
  title: string
  kind: ScheduledItemKind
  startsAt: string
  endsAt?: string | null
  allDay?: boolean
  recurrence?: string | null
  linkedCommitmentId?: string | null
  linkedDecisionId?: string | null
  linkedContactId?: string | null
  notes?: string | null
  status: ScheduledItemStatus
  createdBy?: string | null
  createdAt?: string | null
  externalSync?: ExternalCalendarSync | null
}

export interface CalendarRangeOptions {
  from?: string | number | Date
  to?: string | number | Date
  status?: ScheduledItemStatus
  kind?: ScheduledItemKind
}

export interface CalendarValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validates a scheduled item payload before persistence.
 */
export function validateScheduledItem(input: Partial<ScheduledItem>): CalendarValidationResult {
  const errors: string[] = []

  if (!input.title || !input.title.trim()) {
    errors.push('Title is required.')
  }

  const validKinds: ScheduledItemKind[] = ['reminder', 'review-block', 'meeting', 'deadline', 'check-back']
  if (!input.kind || !validKinds.includes(input.kind)) {
    errors.push(`Kind must be one of: ${validKinds.join(', ')}.`)
  }

  if (!input.startsAt || Number.isNaN(Date.parse(input.startsAt))) {
    errors.push('startsAt must be a valid ISO date-time string.')
  }

  if (input.endsAt) {
    if (Number.isNaN(Date.parse(input.endsAt))) {
      errors.push('endsAt must be a valid ISO date-time string.')
    } else if (input.startsAt && Date.parse(input.endsAt) < Date.parse(input.startsAt)) {
      errors.push('endsAt cannot be earlier than startsAt.')
    }
  }

  if (input.recurrence) {
    const cronErr = validateCron(input.recurrence)
    if (cronErr) {
      errors.push(`Invalid recurrence cron expression: ${cronErr}`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Filter and sort items within a specific time window.
 */
export function filterCalendarItems(
  items: ScheduledItem[],
  options: CalendarRangeOptions = {},
): ScheduledItem[] {
  const fromMs = options.from ? new Date(options.from).getTime() : -Infinity
  const toMs = options.to ? new Date(options.to).getTime() : Infinity

  return items
    .filter((item) => {
      const startMs = new Date(item.startsAt).getTime()
      if (startMs < fromMs || startMs > toMs) return false
      if (options.status && item.status !== options.status) return false
      if (options.kind && item.kind !== options.kind) return false
      return true
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
}

/**
 * Plaintext formatting for the Operator CLI.
 */
export function formatCalendarPlainText(items: ScheduledItem[], rangeLabel = 'Upcoming'): string {
  if (items.length === 0) {
    return `=== Quicksilver Calendar (${rangeLabel}) ===\nNo scheduled items.`
  }

  const lines: string[] = [`=== Quicksilver Calendar (${rangeLabel}) ===\n`]
  for (const item of items) {
    const dateStr = item.startsAt.slice(0, 16).replace('T', ' ')
    const kindTag = `[${item.kind.toUpperCase()}]`
    lines.push(`• ${dateStr} ${kindTag} ${item.title}`)
    if (item.recurrence) {
      lines.push(`    Recurrence: ${item.recurrence}`)
    }
    if (item.notes) {
      lines.push(`    Notes: ${item.notes.slice(0, 80)}`)
    }
    if (item.status !== 'upcoming') {
      lines.push(`    Status: ${item.status}`)
    }
  }
  return lines.join('\n')
}
