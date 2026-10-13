import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'draftedCommunication',
  title: 'Drafted Communication',
  type: 'document',
  fields: [
    defineField({
      name: 'kind',
      type: 'string',
      options: { list: ['email', 'message', 'note'], layout: 'radio' },
      initialValue: 'email',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'to',
      type: 'reference',
      to: [{ type: 'contact' }],
      description: 'The in-app contact this communication is directed to',
      validation: (r) => r.required(),
    }),
    defineField({ name: 'subject', type: 'string' }),
    defineField({
      name: 'body',
      type: 'text',
      rows: 6,
      description: 'The message body — the content is the system of record',
      validation: (r) => r.required(),
    }),
    defineField({ name: 'linkedCommitment', type: 'reference', to: [{ type: 'commitment' }] }),
    defineField({ name: 'linkedDecision', type: 'reference', to: [{ type: 'decision' }] }),
    defineField({
      name: 'status',
      type: 'string',
      options: {
        list: [
          { title: 'Draft', value: 'draft' },
          { title: 'Approved', value: 'approved' },
          { title: 'Sent', value: 'sent' },
          { title: 'Cancelled', value: 'cancelled' },
        ],
        layout: 'dropdown',
      },
      initialValue: 'draft',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'deliveryChannel',
      type: 'string',
      options: { list: ['email', 'slack', 'discord', 'telegram'], layout: 'dropdown' },
      initialValue: 'email',
    }),
    defineField({ name: 'sentAt', type: 'datetime' }),
    defineField({ name: 'createdBy', type: 'string', description: 'Principal ID of creator' }),
    defineField({ name: 'createdAt', type: 'datetime' }),
    defineField({
      name: 'processHistory',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'at', type: 'datetime' }),
            defineField({ name: 'by', type: 'string' }),
            defineField({ name: 'transition', type: 'string' }),
            defineField({ name: 'note', type: 'string' }),
          ],
        },
      ],
    }),
  ],
})
