/**
 * The two-tenant fixture module (acceptance matrix §2.2).
 *
 * Tenant names are synthetic and fixed. Nothing here reads `.env`, a CMS
 * client, a model or vault configuration, so a suite that imports it cannot
 * satisfy a case by accident of the developer's environment.
 */
import { digestOf, MemoryStore, type StoredRow } from '../../../cms/store.ts'
import { createRepositories, type RepositoryMap } from '../../../cms/repositories.ts'

export const TENANT_A = 'tenant-a'
export const TENANT_B = 'tenant-b'
export const TENANTS = [TENANT_A, TENANT_B] as const

export type Tenant = (typeof TENANTS)[number]

/** Business keys both tenants receive, so a merge would be visible. */
export const COLLIDING_KEYS = {
  slug: 'shared-root',
  graphId: 'shared-graph',
  agentId: 'shared-agent',
  lineageId: 'shared-lineage',
} as const

export interface Fixture {
  store: MemoryStore
  repositories: RepositoryMap
}

/** A fresh, isolated store plus every constructed repository. */
export function freshFixture(): Fixture {
  const store = new MemoryStore()
  return { store, repositories: createRepositories(store) }
}

export interface TenantSeed {
  organization: string
  department: string
  entity: string
  capability: string
  policy: string
  objective: string
  agent: string
  workflow: string
  contacts: string[]
}

/** Content rows carry a revision snapshot, the same as a repository write. */
function insertContent(store: MemoryStore, table: string, recordType: string, row: StoredRow): void {
  store.insert(table, row)
  store.insert('qs_content_revisions', {
    tenant_id: row.tenant_id,
    record_type: recordType,
    record_id: row.id,
    revision: row.revision,
    state: 'draft',
    snapshot: row,
    digest: digestOf(row),
    actor_id: 'fixture',
    created_at: store.clock.now(),
  })
}

/**
 * Both tenants receive the same business keys on purpose (§2.2): a merge of
 * rows, heads or audit chains across tenants would be visible in every case.
 */
function seedTenant(store: MemoryStore, tenant: string, slug: string): TenantSeed {
  const at = store.clock.now()
  const base = { tenant_id: tenant, revision: 1, lifecycle: 'draft', created_at: at, created_by: 'fixture', updated_at: at, updated_by: 'fixture' }
  const organization = store.ids.next('org')
  const department = store.ids.next('dep')
  const entity = store.ids.next('ent')
  const capability = store.ids.next('cap')
  const policy = store.ids.next('pol')
  const objective = store.ids.next('obj')
  const agent = store.ids.next('agnt')
  const workflow = store.ids.next('aw')

  insertContent(store, 'qs_organizations', 'organization', { ...base, id: organization, root: true, name: `Root ${tenant}`, slug: COLLIDING_KEYS.slug })
  insertContent(store, 'qs_departments', 'department', { ...base, id: department, organization_id: organization, name: `Operations ${tenant}` })
  insertContent(store, 'qs_entities', 'entity', { ...base, id: entity, department_id: department, name: `Operator ${tenant}` })
  insertContent(store, 'qs_capabilities', 'capability', { ...base, id: capability, name: `Capability ${tenant}` })
  insertContent(store, 'qs_policies', 'policy', { ...base, id: policy, name: `Policy ${tenant}`, lineage_id: COLLIDING_KEYS.lineageId })
  insertContent(store, 'qs_objectives', 'objective', { ...base, id: objective, name: `Objective ${tenant}`, owner_id: null })
  insertContent(store, 'qs_agent_definitions', 'agentDefinition', { ...base, id: agent, agent_id: COLLIDING_KEYS.agentId, version: 1 })
  insertContent(store, 'qs_automation_workflows', 'automationWorkflow', { ...base, id: workflow, graph_id: COLLIDING_KEYS.graphId, version: 1 })
  store.insert('qs_workflow_publication_heads', { tenant_id: tenant, id: store.ids.next('head'), graph_id: COLLIDING_KEYS.graphId, active_version: 1, cas_revision: 1, updated_at: at })

  const contacts = [0, 1, 2].map((index) => {
    const id = store.ids.next('con')
    insertContent(store, 'qs_contacts', 'contact', { ...base, id, name: `Contact ${index} ${tenant}`, kind: 'person', status: 'active' })
    return id
  })

  return { organization, department, entity, capability, policy, objective, agent, workflow, contacts }
}

export interface SeededFixture extends Fixture {
  seeds: Record<Tenant, TenantSeed>
}

/** A fresh store with identical business keys in tenant A and tenant B. */
export function seededFixture(): SeededFixture {
  const fixture = freshFixture()
  const seeds = {
    [TENANT_A]: seedTenant(fixture.store, TENANT_A, COLLIDING_KEYS.slug),
    [TENANT_B]: seedTenant(fixture.store, TENANT_B, COLLIDING_KEYS.slug),
  }
  return { ...fixture, seeds }
}

/** The environment keys a native path must never read for tenant or CMS. */
export const FORBIDDEN_ENV = [
  'QUICKSILVER_TENANT_ID',
  'SANITY_STUDIO_PROJECT_ID',
  'SANITY_STUDIO_DATASET',
  'SANITY_AUTH_TOKEN',
  'SANITY_READ_TOKEN',
  'SANITY_WRITE_TOKEN',
  'NEXT_PUBLIC_SANITY_PROJECT_ID',
  'NEXT_PUBLIC_SANITY_DATASET',
  'SANITY_DATASET_PUBLIC',
] as const

/** Clears the forbidden keys and returns a restore function. */
export function clearForbiddenEnv(): () => void {
  const saved = new Map<string, string | undefined>()
  for (const key of FORBIDDEN_ENV) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
