import { ontologySchemas } from '../../../ontology/index.ts'

// Strapi plugin content-type registry. Enabling the Quicksilver plugin in a
// Strapi host makes these schemas available as plugin::quicksilver.<type>.
export default Object.fromEntries(
  Object.entries(ontologySchemas).map(([name, schema]) => [name, { schema }]),
)
