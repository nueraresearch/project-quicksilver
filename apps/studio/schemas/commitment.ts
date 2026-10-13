import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'commitment',
  title: 'Commitment',
  type: 'document',
  fields: [
    defineField({ name: 'title', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'direction', type: 'string', options: { list: [
      { title: 'I owe this', value: 'i-owe' },
      { title: 'They owe me this', value: 'they-owe' },
    ], layout: 'radio' }, validation: (r) => r.required() }),
    defineField({ name: 'counterparty', type: 'reference', to: [{ type: 'contact' }] }),
    defineField({ name: 'dueAt', type: 'datetime' }),
    defineField({ name: 'checkBackAt', type: 'datetime' }),
    defineField({ name: 'status', type: 'string', options: { list: ['open', 'done', 'deferred', 'dropped'], layout: 'dropdown' }, initialValue: 'open' }),
    defineField({ name: 'deferredUntil', type: 'datetime' }),
    defineField({ name: 'context', type: 'text', rows: 4, description: 'Why this commitment exists — required', validation: (r) => r.required() }),
    defineField({ name: 'linkedDecision', type: 'reference', to: [{ type: 'decision' }] }),
    defineField({ name: 'createdBy', type: 'string', description: 'Principal ID of the creator' }),
    defineField({ name: 'createdAt', type: 'datetime' }),
    defineField({ name: 'processHistory', type: 'array', of: [{ type: 'object', fields: [
      defineField({ name: 'at', type: 'datetime' }),
      defineField({ name: 'by', type: 'string' }),
      defineField({ name: 'transition', type: 'string' }),
      defineField({ name: 'note', type: 'string' }),
    ]}]}),
  ],
})
