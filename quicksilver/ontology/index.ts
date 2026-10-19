import capability from './capability/schema.json'
import decision from './decision/schema.json'
import department from './department/schema.json'
import entity from './entity/schema.json'
import evidence from './evidence/schema.json'
import metric from './metric/schema.json'
import objective from './objective/schema.json'
import organization from './organization/schema.json'
import policy from './policy/schema.json'
import workflow from './workflow/schema.json'

export const ontologySchemas = {
  organization,
  department,
  entity,
  capability,
  policy,
  objective,
  workflow,
  evidence,
  decision,
  metric,
} as const

export type OntologyContentType = keyof typeof ontologySchemas
