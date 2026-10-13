import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateScheduledItem,
  filterCalendarItems,
  formatCalendarPlainText,
  type ScheduledItem,
} from './calendar.ts'

test('Calendar engine: validates valid scheduled item', () => {
  const item: Partial<ScheduledItem> = {
    title: 'Q4 Operational Review',
    kind: 'review-block',
    startsAt: '2026-10-15T14:00:00Z',
    endsAt: '2026-10-15T15:00:00Z',
    recurrence: '@weekly',
  }

  const result = validateScheduledItem(item)
  assert.equal(result.valid, true)
  assert.equal(result.errors.length, 0)
})

test('Calendar engine: refuses invalid properties', () => {
  const missingTitle = validateScheduledItem({
    kind: 'meeting',
    startsAt: '2026-10-15T14:00:00Z',
  })
  assert.equal(missingTitle.valid, false)
  assert.match(missingTitle.errors[0]!, /Title is required/)

  const badDate = validateScheduledItem({
    title: 'Review',
    kind: 'review-block',
    startsAt: 'not-a-date',
  })
  assert.equal(badDate.valid, false)
  assert.match(badDate.errors[0]!, /startsAt must be a valid ISO/)

  const endsBeforeStarts = validateScheduledItem({
    title: 'Review',
    kind: 'review-block',
    startsAt: '2026-10-15T14:00:00Z',
    endsAt: '2026-10-15T13:00:00Z',
  })
  assert.equal(endsBeforeStarts.valid, false)
  assert.match(endsBeforeStarts.errors[0]!, /endsAt cannot be earlier than startsAt/)

  const badCron = validateScheduledItem({
    title: 'Review',
    kind: 'review-block',
    startsAt: '2026-10-15T14:00:00Z',
    recurrence: 'invalid-cron',
  })
  assert.equal(badCron.valid, false)
  assert.match(badCron.errors[0]!, /Invalid recurrence cron expression/)
})

test('Calendar engine: filters and sorts items by date window and kind', () => {
  const items: ScheduledItem[] = [
    {
      id: 'item-2',
      title: 'Follow-up with Atlas',
      kind: 'check-back',
      startsAt: '2026-10-18T10:00:00Z',
      status: 'upcoming',
    },
    {
      id: 'item-1',
      title: 'Tax deadline',
      kind: 'deadline',
      startsAt: '2026-10-14T09:00:00Z',
      status: 'upcoming',
    },
    {
      id: 'item-3',
      title: 'Monthly Planning',
      kind: 'review-block',
      startsAt: '2026-10-25T15:00:00Z',
      status: 'done',
    },
  ]

  const filtered = filterCalendarItems(items, {
    from: '2026-10-13T00:00:00Z',
    to: '2026-10-20T00:00:00Z',
    status: 'upcoming',
  })

  assert.equal(filtered.length, 2)
  assert.equal(filtered[0]!.id, 'item-1')
  assert.equal(filtered[1]!.id, 'item-2')

  const text = formatCalendarPlainText(filtered, 'Next 7 Days')
  assert.match(text, /Next 7 Days/)
  assert.match(text, /Tax deadline/)
  assert.match(text, /Follow-up with Atlas/)
})
