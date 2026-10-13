import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'contact',
  title: 'Contact',
  type: 'document',
  fields: [
    defineField({ name: 'name', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'kind', type: 'string', options: { list: ['person', 'organization'], layout: 'radio' } }),
    defineField({ name: 'email', type: 'string' }),
    defineField({ name: 'notes', type: 'text', rows: 3 }),
    defineField({ name: 'checkBackCadence', type: 'string', description: 'Optional cron expression to resurface this contact periodically' }),
    defineField({ name: 'lastInteractionAt', type: 'datetime' }),
    defineField({ name: 'status', type: 'string', options: { list: ['active', 'archived'], layout: 'dropdown' }, initialValue: 'active' }),
    defineField({ name: 'externalSync', type: 'object', fields: [
      defineField({ name: 'provider', type: 'string', options: { list: ['google', 'hubspot', 'salesforce'] } }),
      defineField({ name: 'externalId', type: 'string' }),
      defineField({ name: 'syncedAt', type: 'datetime' }),
    ]}),
  ],
})
