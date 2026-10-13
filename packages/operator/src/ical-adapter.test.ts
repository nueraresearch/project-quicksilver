import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportToIcs, parseIcs } from './ical-adapter.ts'
import type { ScheduledItem } from './calendar.ts'

test('iCal adapter: exports scheduledItems to RFC 5545 format', () => {
  const items: ScheduledItem[] = [
    {
      id: 'event-101',
      title: 'Board Governance Sync',
      kind: 'meeting',
      startsAt: '2026-10-20T14:00:00.000Z',
      endsAt: '2026-10-20T15:00:00.000Z',
      notes: 'Review Q4 strategy and burn rate',
      status: 'upcoming',
      createdAt: '2026-10-12T12:00:00.000Z',
    },
  ]

  const ics = exportToIcs(items)
  assert.match(ics, /BEGIN:VCALENDAR/)
  assert.match(ics, /VERSION:2\.0/)
  assert.match(ics, /UID:event-101/)
  assert.match(ics, /DTSTART:20261020T140000Z/)
  assert.match(ics, /DTEND:20261020T150000Z/)
  assert.match(ics, /SUMMARY:\[MEETING\] Board Governance Sync/)
  assert.match(ics, /DESCRIPTION:Review Q4 strategy and burn rate/)
  assert.match(ics, /END:VCALENDAR/)
})

test('iCal adapter: parses raw ICS feed into scheduled items', () => {
  const rawIcs = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:external-cal-1',
    'DTSTART:20261022T090000Z',
    'DTEND:20261022T100000Z',
    'SUMMARY:[DEADLINE] Budget submission',
    'DESCRIPTION:Deliver spreadsheet to CFO',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const parsed = parseIcs(rawIcs)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]!.title, 'Budget submission')
  assert.equal(parsed[0]!.kind, 'deadline')
  assert.equal(parsed[0]!.startsAt, '2026-10-22T09:00:00.000Z')
  assert.equal(parsed[0]!.endsAt, '2026-10-22T10:00:00.000Z')
  assert.equal(parsed[0]!.notes, 'Deliver spreadsheet to CFO')
  assert.equal(parsed[0]!.externalSync?.provider, 'ical')
  assert.equal(parsed[0]!.externalSync?.externalId, 'external-cal-1')
})
