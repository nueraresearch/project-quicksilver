import { defineType, defineField } from 'sanity'

/**
 * The review document.
 * A generated, time-stamped snapshot of the operator queue and operational cadence.
 * Informational only — not an authorization artifact.
 */
export default defineType({
  name: 'review',
  title: 'Operator Review',
  type: 'document',
  fields: [
    defineField({ name: 'title', type: 'string', validation: (r) => r.required() }),
    defineField({
      name: 'cadence',
      type: 'string',
      options: {
        list: [
          { title: 'Daily Attention', value: 'daily' },
          { title: 'Weekly Synthesis', value: 'weekly' },
          { title: 'Stale Loop Review', value: 'stale-loops' },
          { title: 'Approvals Review', value: 'approvals' },
        ],
        layout: 'dropdown',
      },
      initialValue: 'daily',
      validation: (r) => r.required(),
    }),
    defineField({ name: 'periodStart', type: 'datetime' }),
    defineField({ name: 'periodEnd', type: 'datetime' }),
    defineField({ name: 'summary', type: 'text', rows: 4, validation: (r) => r.required() }),
    defineField({
      name: 'highlights',
      type: 'array',
      of: [{ type: 'string' }],
    }),
    defineField({
      name: 'metrics',
      type: 'object',
      fields: [
        defineField({ name: 'pendingDecisionsCount', type: 'number' }),
        defineField({ name: 'dueCommitmentsCount', type: 'number' }),
        defineField({ name: 'waitingOnOthersCount', type: 'number' }),
        defineField({ name: 'upcomingCount', type: 'number' }),
        defineField({ name: 'staleItemsCount', type: 'number' }),
      ],
    }),
    defineField({
      name: 'decisions',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'decision' }] }],
    }),
    defineField({
      name: 'commitments',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'commitment' }] }],
    }),
    defineField({
      name: 'generatedAt',
      type: 'datetime',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'generatedBy',
      type: 'string',
      description: 'Principal or service ID that generated the review',
      initialValue: 'system:review-engine',
    }),
  ],
})
