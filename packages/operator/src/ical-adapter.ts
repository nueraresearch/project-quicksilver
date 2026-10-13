/**
 * iCal / ICS Calendar Sync Adapter (Operator Organization Layer — Phase 5).
 *
 * Provides credential-free export and import of scheduledItem documents
 * into/from the standard iCalendar (RFC 5545) format.
 *
 * Fail-closed: Malformed calendar feeds refuse work rather than corrupting data.
 * Quicksilver is always the authority; external calendar feeds are sync targets.
 */

import { randomUUID } from 'node:crypto'
import type { ScheduledItem, ScheduledItemKind } from './calendar.ts'

export interface IcsEventInput {
  uid?: string
  title: string
  description?: string
  startsAt: string
  endsAt?: string
  recurrenceRule?: string
}

function formatDateToIcsUtc(isoString: string): string {
  const date = new Date(isoString)
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function parseIcsUtcToIso(icsDateStr: string): string {
  // Format: YYYYMMDDTHHMMSSZ or YYYYMMDD
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(icsDateStr.trim())
  if (!match) throw new Error(`Invalid ICS date format: "${icsDateStr}"`)

  const [, year, month, day, hour = '00', min = '00', sec = '00'] = match
  const date = new Date(Date.UTC(+year!, +month! - 1, +day!, +hour, +min, +sec))
  return date.toISOString()
}

/**
 * Serializes scheduledItems into standard .ics string format.
 */
export function exportToIcs(items: ScheduledItem[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nuera Quicksilver//Operator Calendar 0.8.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const item of items) {
    const uid = item.id || `qs-${randomUUID()}`
    const dtStamp = formatDateToIcsUtc(item.createdAt || new Date().toISOString())
    const dtStart = formatDateToIcsUtc(item.startsAt)
    const dtEnd = item.endsAt ? formatDateToIcsUtc(item.endsAt) : dtStart

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uid}`)
    lines.push(`DTSTAMP:${dtStamp}`)
    lines.push(`DTSTART:${dtStart}`)
    lines.push(`DTEND:${dtEnd}`)
    lines.push(`SUMMARY:${escapeIcsText(`[${item.kind.toUpperCase()}] ${item.title}`)}`)
    if (item.notes) {
      lines.push(`DESCRIPTION:${escapeIcsText(item.notes)}`)
    }
    if (item.status) {
      lines.push(`STATUS:${item.status === 'done' ? 'COMPLETED' : item.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`)
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/**
 * Parses raw .ics file content into scheduled item objects for import.
 */
export function parseIcs(rawIcs: string): Partial<ScheduledItem>[] {
  const events: Partial<ScheduledItem>[] = []
  const clean = rawIcs.replace(/\r\n\s+/g, '') // Unfold lines
  const lines = clean.split(/\r?\n/)

  let inEvent = false
  let current: Partial<ScheduledItem> = {}

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true
      current = { status: 'upcoming', kind: 'reminder' }
      continue
    }

    if (trimmed === 'END:VEVENT') {
      if (current.title && current.startsAt) {
        events.push(current)
      }
      inEvent = false
      current = {}
      continue
    }

    if (!inEvent) continue

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue

    const prop = trimmed.slice(0, colonIdx).split(';')[0]!.toUpperCase()
    const val = trimmed.slice(colonIdx + 1)

    if (prop === 'UID') {
      current.externalSync = {
        provider: 'ical',
        externalId: val,
        syncedAt: new Date().toISOString(),
      }
    } else if (prop === 'SUMMARY') {
      current.title = unescapeIcsText(val)
      // Infer kind if tagged
      const kindMatch = /^\[(REMINDER|REVIEW-BLOCK|MEETING|DEADLINE|CHECK-BACK)\]\s*(.*)$/i.exec(current.title)
      if (kindMatch) {
        current.kind = kindMatch[1]!.toLowerCase() as ScheduledItemKind
        current.title = kindMatch[2]!
      }
    } else if (prop === 'DESCRIPTION') {
      current.notes = unescapeIcsText(val)
    } else if (prop === 'DTSTART') {
      try {
        current.startsAt = parseIcsUtcToIso(val)
      } catch {
        // invalid date skips
      }
    } else if (prop === 'DTEND') {
      try {
        current.endsAt = parseIcsUtcToIso(val)
      } catch {
        // invalid date
      }
    } else if (prop === 'STATUS') {
      if (val === 'COMPLETED') current.status = 'done'
      else if (val === 'CANCELLED') current.status = 'cancelled'
      else current.status = 'upcoming'
    }
  }

  return events
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function unescapeIcsText(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}
