import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'scheduledItem',
  title: 'Scheduled Item',
  type: 'document',
  fields: [
    defineField({ name: 'title', type: 'string', validation: (r) => r.required() }),
    defineField({
      name: 'kind',
      type: 'string',
      options: {
        list: [
          { title: 'Reminder', value: 'reminder' },
          { title: 'Review Block', value: 'review-block' },
          { title: 'Meeting', value: 'meeting' },
          { title: 'Deadline', value: 'deadline' },
          { title: 'Check-back', value: 'check-back' },
        ],
        layout: 'dropdown',
      },
      validation: (r) => r.required(),
      initialValue: 'reminder',
    }),
    defineField({ name: 'startsAt', type: 'datetime', validation: (r) => r.required() }),
    defineField({ name: 'endsAt', type: 'datetime' }),
    defineField({ name: 'allDay', type: 'boolean', initialValue: false }),
    defineField({
      name: 'recurrence',
      type: 'string',
      description: 'Optional cron expression (e.g. "@daily", "0 9 * * 1-5") for recurring items',
    }),
    defineField({ name: 'linkedCommitment', type: 'reference', to: [{ type: 'commitment' }] }),
    defineField({ name: 'linkedDecision', type: 'reference', to: [{ type: 'decision' }] }),
    defineField({ name: 'linkedContact', type: 'reference', to: [{ type: 'contact' }] }),
    defineField({ name: 'notes', type: 'text', rows: 3 }),
    defineField({
      name: 'status',
      type: 'string',
      options: {
        list: [
          { title: 'Upcoming', value: 'upcoming' },
          { title: 'Done', value: 'done' },
          { title: 'Cancelled', value: 'cancelled' },
        ],
        layout: 'dropdown',
      },
      initialValue: 'upcoming',
      validation: (r) => r.required(),
    }),
    defineField({ name: 'createdBy', type: 'string', description: 'Principal ID of the creator' }),
    defineField({ name: 'createdAt', type: 'datetime' }),
    defineField({
      name: 'externalSync',
      type: 'object',
      description: 'Populated only when synced to/from an external calendar target — never required',
      fields: [
        defineField({
          name: 'provider',
          type: 'string',
          options: { list: ['google', 'ical', 'outlook'] },
        }),
        defineField({ name: 'externalId', type: 'string' }),
        defineField({ name: 'syncedAt', type: 'datetime' }),
        defineField({ name: 'etag', type: 'string' }),
      ],
    }),
  ],
})
