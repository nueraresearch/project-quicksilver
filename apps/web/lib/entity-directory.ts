import type { SanityClient } from '@sanity/client'
import { capRows } from './list-bounds.ts'

export const ENTITY_DIRECTORY_LIMIT = 500

export type EntityDirectoryRecord = {
  id: string
  name: string
  entityType: string
  availability?: string | null
  riskProfile?: number | null
  costProfile?: string | null
  department?: string | null
  reportsTo?: { id: string; name: string } | null
  capabilities?: Array<{ id: string; name: string }>
}

// One row past the cap is fetched and dropped, so `truncated` reflects what the dataset holds.
const ENTITY_DIRECTORY_QUERY = `{
  "total": count(*[_type == "entity"]),
  "entities": *[_type == "entity"] | order(name asc)[0...${ENTITY_DIRECTORY_LIMIT + 1}]{
    "id": _id,
    name,
    entityType,
    availability,
    riskProfile,
    costProfile,
    "department": department->name,
    "reportsTo": reportsTo->{"id": _id, name},
    "capabilities": capabilities[]->{"id": _id, name}
  }
}`

export async function loadEntityDirectory(client: Pick<SanityClient, 'fetch'>): Promise<{ total: number; entities: EntityDirectoryRecord[]; truncated: boolean }> {
  const directory = await client.fetch<{ total: number; entities: EntityDirectoryRecord[] }>(ENTITY_DIRECTORY_QUERY)
  const { rows, truncated } = capRows(directory.entities, ENTITY_DIRECTORY_LIMIT)
  return { total: directory.total, entities: rows, truncated }
}
