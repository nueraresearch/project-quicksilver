/**
 * The two-tenant fixture module (acceptance matrix §2.2).
 *
 * Tenant names are synthetic and fixed. Nothing here reads `.env`, a CMS
 * client, a model or vault configuration, so a suite that imports it cannot
 * satisfy a case by accident of the developer's environment.
 *
 * Both tenants receive the same business keys on purpose: a merge of rows,
 * relations, heads or audit chains across tenants would be visible in a case.
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

/** A graph that exists only in tenant B, for foreign-id query cases. */
export const FOREIGN_GRAPH = 'tenant-b-graph'

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
  capability2: string
  policy: string
  objective: string
  objectiveChild: string
  workflow: string
  evidence: string
  evidence2: string
  decision: string
  metric: string
  agent: string
  agentHead: string
  workflowHead: string
  commitment: string
  scheduledItem: string
  draft: string
  contacts: string[]
}

function insertContent(store: MemoryStore, table: string, recordType: string, row: StoredRow): void {
  store.insert(table, row)
  store.insert('qs_content_revisions', {
    tenant_id: row.tenant_id,
    record_type: recordType,
    record_id: row.id,
    revision: row.revision,
    state: row.lifecycle === 'published' ? 'published' : 'draft',
    snapshot: row,
    digest: digestOf(row),
    actor_id: 'fixture',
    created_at: store.clock.now(),
  })
}

function seedTenant(store: MemoryStore, tenant: string): TenantSeed {
  const at = store.clock.now()
  const base = { tenant_id: tenant, revision: 1, lifecycle: 'published', created_at: at, created_by: 'fixture', updated_at: at, updated_by: 'fixture' }
  const ids = {
    organization: store.ids.next('org'),
    department: store.ids.next('dep'),
    entity: store.ids.next('ent'),
    capability: store.ids.next('cap'),
    capability2: store.ids.next('cap'),
    policy: store.ids.next('pol'),
    objective: store.ids.next('obj'),
    objectiveChild: store.ids.next('obj'),
    workflow: store.ids.next('wf'),
    evidence: store.ids.next('evd'),
    evidence2: store.ids.next('evd'),
    decision: store.ids.next('dec'),
    metric: store.ids.next('met'),
    agent: store.ids.next('agnt'),
    agentHead: store.ids.next('ahd'),
    workflowHead: store.ids.next('whd'),
    commitment: store.ids.next('com'),
    scheduledItem: store.ids.next('sch'),
    draft: store.ids.next('drf'),
  }

  insertContent(store, 'qs_organizations', 'organization', { ...base, id: ids.organization, root: true, name: `Root ${tenant}`, slug: COLLIDING_KEYS.slug })
  insertContent(store, 'qs_departments', 'department', { ...base, id: ids.department, organization_id: ids.organization, name: `Operations ${tenant}` })
  insertContent(store, 'qs_entities', 'entity', { ...base, id: ids.entity, department_id: ids.department, name: `Operator ${tenant}` })
  insertContent(store, 'qs_capabilities', 'capability', {
    ...base,
    id: ids.capability,
    name: `Capability ${tenant}`,
    risk_level: 2,
    policy_scopes: ['internal'],
    inherits_ids: [ids.capability2],
    requires_ids: [],
    conflicts_with_ids: [],
  })
  insertContent(store, 'qs_capabilities', 'capability', { ...base, id: ids.capability2, name: `Base capability ${tenant}`, risk_level: 1, policy_scopes: [] })
  insertContent(store, 'qs_policies', 'policy', { ...base, id: ids.policy, organization_id: ids.organization, name: `Policy ${tenant}`, lineage_id: COLLIDING_KEYS.lineageId, effect: 'allow', priority: 10 })
  insertContent(store, 'qs_objectives', 'objective', { ...base, id: ids.objective, organization_id: ids.organization, department_id: ids.department, name: `Objective ${tenant}`, owner_id: null, parent_id: null, child_ids: [ids.objectiveChild], status: 'active' })
  insertContent(store, 'qs_objectives', 'objective', { ...base, id: ids.objectiveChild, organization_id: ids.organization, department_id: ids.department, name: `Child objective ${tenant}`, owner_id: null, parent_id: ids.objective, child_ids: [], status: 'active' })
  insertContent(store, 'qs_workflows', 'workflow', { ...base, id: ids.workflow, department_id: ids.department, objective_id: ids.objective, name: `Workflow ${tenant}` })

  const versionOne = {
    tenant_id: tenant,
    revision: 1,
    lifecycle: 'active',
    created_at: at,
    created_by: 'fixture',
    updated_at: at,
    updated_by: 'fixture',
    id: store.ids.next('aw'),
    graph_id: COLLIDING_KEYS.graphId,
    version: 1,
    entry_node_id: 'start',
    nodes: [
      { id: 'start', kind: 'entry', label: 'Start', config: null },
      { id: 'end', kind: 'task', label: 'End', config: null },
    ],
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
    digest: '',
  }
  versionOne.digest = digestOf({ ...versionOne, digest: undefined })
  store.insert('qs_automation_workflows', versionOne)
  // Tenant B also holds version 2, so pointing A's head at it is cross-tenant.
  if (tenant === TENANT_B) {
    const versionTwo = { ...versionOne, id: store.ids.next('aw'), version: 2, created_at: at, updated_at: at }
    versionTwo.digest = digestOf({ ...versionTwo, digest: undefined })
    store.insert('qs_automation_workflows', versionTwo)
    const foreign = { ...versionOne, id: store.ids.next('aw'), graph_id: FOREIGN_GRAPH, version: 1 }
    foreign.digest = digestOf({ ...foreign, digest: undefined })
    store.insert('qs_automation_workflows', foreign)
    store.insert('qs_workflow_publication_heads', { tenant_id: tenant, id: store.ids.next('whd'), graph_id: FOREIGN_GRAPH, active_version: 1, cas_revision: 1, updated_at: at })
  }
  ids.workflowHead = store.ids.next('whd')
  store.insert('qs_workflow_publication_heads', { tenant_id: tenant, id: ids.workflowHead, graph_id: COLLIDING_KEYS.graphId, active_version: 1, cas_revision: 1, updated_at: at })

  insertContent(store, 'qs_agent_definitions', 'agentDefinition', { ...base, id: ids.agent, agent_id: COLLIDING_KEYS.agentId, version: 1, lifecycle: 'active' })
  if (tenant === TENANT_B) {
    insertContent(store, 'qs_agent_definitions', 'agentDefinition', { ...base, id: store.ids.next('agnt'), agent_id: COLLIDING_KEYS.agentId, version: 2, lifecycle: 'active' })
  }
  insertContent(store, 'qs_agent_publication_heads', 'agentPublicationHead', { ...base, lifecycle: 'active', id: ids.agentHead, agent_id: COLLIDING_KEYS.agentId, active_version: 1, cas_revision: 1 })

  insertContent(store, 'qs_metrics', 'metric', { ...base, id: ids.metric, name: `Metric ${tenant}`, objective_id: ids.objective, related_decision_id: null, value: 10 })
  insertContent(store, 'qs_decisions', 'decision', { ...base, id: ids.decision, objective_id: ids.objective, workflow_id: ids.workflow, kind: 'plan', status: 'proposed', context_entity_id: null, context_capability_id: null, context_policy_id: null })
  store.insert('qs_decision_events', {
    tenant_id: tenant,
    id: store.ids.next('evt'),
    decision_id: ids.decision,
    seq: 1,
    event_id: store.ids.next('ev'),
    event_type: 'proposed',
    from_status: null,
    to_status: 'proposed',
    actor_id: 'fixture',
    at,
    payload_digest: digestOf({ tenant, decision: ids.decision, seq: 1 }),
    prev_hash: null,
    hash: digestOf({ tenant, decision: ids.decision, seq: 1 }),
  })
  insertContent(store, 'qs_evidence', 'evidence', { ...base, id: ids.evidence, metric_id: ids.metric, objective_id: ids.objective, title: `Evidence ${tenant}`, type: 'measurement', observed_at: at, contradicts_ids: [ids.evidence2], confidence: 0.7 })
  insertContent(store, 'qs_evidence', 'evidence', { ...base, id: ids.evidence2, metric_id: ids.metric, objective_id: ids.objective, title: `Contradicting evidence ${tenant}`, type: 'measurement', observed_at: at, contradicts_ids: [], confidence: 0.4 })

  insertContent(store, 'qs_commitments', 'commitment', { ...base, id: ids.commitment, title: `Commitment ${tenant}`, status: 'open', linked_decision_id: null })
  insertContent(store, 'qs_scheduled_items', 'scheduledItem', { ...base, id: ids.scheduledItem, title: `Item ${tenant}`, status: 'upcoming', linked_commitment_id: null, linked_decision_id: null, linked_contact_id: null })
  insertContent(store, 'qs_drafted_communications', 'draftedCommunication', { ...base, id: ids.draft, kind: 'email', subject: `Hello ${tenant}`, status: 'draft', contact_id: null, linked_commitment_id: null, linked_decision_id: null })

  const contacts = [0, 1, 2].map((index) => {
    const id = store.ids.next('con')
    insertContent(store, 'qs_contacts', 'contact', { ...base, lifecycle: 'active', id, name: `Contact ${index} ${tenant}`, kind: 'person', status: 'active' })
    return id
  })

  return { ...ids, contacts }
}

export interface SeededFixture extends Fixture {
  seeds: Record<Tenant, TenantSeed>
}

/** A fresh store with identical business keys in tenant A and tenant B. */
export function seededFixture(): SeededFixture {
  const fixture = freshFixture()
  const seeds = {
    [TENANT_A]: seedTenant(fixture.store, TENANT_A),
    [TENANT_B]: seedTenant(fixture.store, TENANT_B),
  }
  return { ...fixture, seeds }
}

/** The fixture row used as a relation endpoint, by table. */
export function rowFor(seeds: Record<Tenant, TenantSeed>, table: string, tenant: Tenant): string {
  const seed = seeds[tenant]
  const map: Record<string, string> = {
    qs_organizations: seed.organization,
    qs_departments: seed.department,
    qs_entities: seed.entity,
    qs_capabilities: seed.capability,
    qs_policies: seed.policy,
    qs_objectives: seed.objective,
    qs_workflows: seed.workflow,
    qs_evidence: seed.evidence,
    qs_decisions: seed.decision,
    qs_metrics: seed.metric,
    qs_agents: seed.agent,
    qs_agent_definitions: seed.agent,
    qs_commitments: seed.commitment,
    qs_scheduled_items: seed.scheduledItem,
    qs_drafted_communications: seed.draft,
    qs_contacts: seed.contacts[0]!,
    qs_workflow_publication_heads: seed.workflowHead,
    qs_agent_publication_heads: seed.agentHead,
  }
  const id = map[table]
  if (!id) throw new Error(`no fixture row for ${table}`)
  return id
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
