/**
 * Gate B — two-tenant fixtures and cross-tenant refusals (matrix §4), cases
 * B01–B05: business-key collisions, foreign-id reads, list scoping, cursor reuse
 * across tenants, and a cross-tenant relation write.
 *
 * Each case pairs its refusal with a same-tenant positive control, so a
 * repository that refuses everything cannot make the gate green.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { C1_STORES } from '../../cms/catalog.ts'
import { RepositoryError } from '../../cms/errors.ts'
import {
  findContradictions,
  getCapabilityGraph,
  getDecisionHistory,
  getEvidenceForMetric,
  getObjectiveTree,
  getWorkflowDAG,
} from '../../cms/queries.ts'
import { RELATION_INVENTORY, linkRelation } from '../../cms/relations.ts'
import type {
  AgentPublicationHeadRepository,
  CapabilityRepository,
  CommitmentRepository,
  DecisionRepository,
  DepartmentRepository,
  DraftedCommunicationRepository,
  ObjectiveRepository,
  ScheduledItemRepository,
  WorkflowPublicationHeadRepository,
} from '../../cms/repositories.ts'
import { COLLIDING_KEYS, FOREIGN_GRAPH, TENANT_A, TENANT_B, rowFor, seededFixture } from './fixtures/two-tenants.ts'

function code(error: unknown): string | undefined {
  return error instanceof RepositoryError ? error.code : undefined
}

test('C1-B01 identical business keys resolve to each tenant’s own record', async () => {
  const { repositories, seeds } = seededFixture()
  const organizations = repositories.OrganizationRepository as unknown as {
    getRoot(tenantId: string): Promise<{ id: string; slug: string }>
  }
  const agents = repositories.AgentDefinitionRepository
  const workflows = repositories.AutomationWorkflowRepository
  const policies = repositories.PolicyRepository

  const rootA = await organizations.getRoot(TENANT_A)
  const rootB = await organizations.getRoot(TENANT_B)
  assert.equal(rootA.slug, COLLIDING_KEYS.slug)
  assert.equal(rootB.slug, COLLIDING_KEYS.slug)
  assert.notEqual(rootA.id, rootB.id, 'colliding business keys must not merge rows')

  const agentA = await agents.getByKey(TENANT_A, 'agent_id', COLLIDING_KEYS.agentId)
  const agentB = await agents.getByKey(TENANT_B, 'agent_id', COLLIDING_KEYS.agentId)
  assert.notEqual(agentA.id, agentB.id)

  const workflowA = await workflows.getByKey(TENANT_A, 'graph_id', COLLIDING_KEYS.graphId)
  const workflowB = await workflows.getByKey(TENANT_B, 'graph_id', COLLIDING_KEYS.graphId)
  assert.notEqual(workflowA.id, workflowB.id)

  const policyA = await policies.getByKey(TENANT_A, 'lineage_id', COLLIDING_KEYS.lineageId)
  const policyB = await policies.getByKey(TENANT_B, 'lineage_id', COLLIDING_KEYS.lineageId)
  assert.notEqual(policyA.id, policyB.id)

  // The seeds are the fixture's own: no record was copied between tenants.
  assert.equal(rootA.id, seeds[TENANT_A].organization)
  assert.equal(agentB.id, seeds[TENANT_B].agent)
})

test('C1-B02 reading another tenant’s record by id is NotFound with no body or existence detail', async () => {
  const { repositories, seeds, store } = seededFixture()
  const organizations = repositories.OrganizationRepository

  await assert.rejects(organizations.get(TENANT_A, seeds[TENANT_B].organization), (error: unknown) => {
    assert.equal(code(error), 'NotFound')
    assert.doesNotMatch(String((error as Error).message), /tenant-b/i, 'the refusal must not name the other tenant')
    return true
  })

  // Neither tenant changed, and A still reads its own record.
  const rootA = await organizations.get(TENANT_A, seeds[TENANT_A].organization)
  assert.equal(rootA.id, seeds[TENANT_A].organization)
  assert.equal(store.rawDump(TENANT_B, 'qs_organizations').length, 1)
  assert.equal(store.rawDump(TENANT_A, 'qs_organizations').length, 1)
})

test('C1-B03 every repository lists only its tenant’s rows', async () => {
  const { repositories, seeds } = seededFixture()
  const seenInBoth: string[] = []
  const leaked: string[] = []

  for (const definition of C1_STORES) {
    const repository = repositories[definition.repository]
    const pageA = await repository.list(TENANT_A, { limit: 100 })
    const pageB = await repository.list(TENANT_B, { limit: 100 })

    for (const row of pageA.items) if (row.tenant_id !== TENANT_A) leaked.push(`${definition.name}:${row.id}`)
    for (const row of pageB.items) if (row.tenant_id !== TENANT_B) leaked.push(`${definition.name}:${row.id}`)

    const idsB = new Set(pageB.items.map((row) => row.id))
    for (const row of pageA.items) if (idsB.has(row.id)) seenInBoth.push(`${definition.name}:${row.id}`)
  }

  assert.deepEqual(leaked, [], 'no page may contain another tenant’s row')
  assert.deepEqual(seenInBoth, [], 'no row may appear in both tenants')
  assert.equal((await repositories.ContactRepository.list(TENANT_A, { limit: 100 })).items.length, seeds[TENANT_A].contacts.length)
  assert.equal((await repositories.ContactRepository.list(TENANT_B, { limit: 100 })).items.length, seeds[TENANT_B].contacts.length)
})

test('C1-B04 a cursor is tenant-bound: reused across tenants it is MalformedQuery, reused in its own tenant it repeats the same page', async () => {
  const { repositories } = seededFixture()
  const contacts = repositories.ContactRepository

  const first = await contacts.list(TENANT_A, { limit: 2 })
  assert.equal(first.items.length, 2)
  assert.ok(first.nextCursor, 'a two-of-three page must offer a cursor')

  await assert.rejects(contacts.list(TENANT_B, { limit: 2, cursor: first.nextCursor! }), (error: unknown) => {
    assert.equal(code(error), 'MalformedQuery')
    return true
  })

  const retry = await contacts.list(TENANT_A, { limit: 2, cursor: first.nextCursor! })
  assert.equal(retry.items.length, 1, 'the last page holds the remaining row')
  assert.notEqual(retry.items[0]?.id, first.items[0]?.id)
  assert.notEqual(retry.items[0]?.id, first.items[1]?.id)
  assert.equal(retry.nextCursor, null)
})

test('C1-B05 a relation target in another tenant is CrossTenantRelation and changes nothing', async () => {
  const { repositories, seeds, store } = seededFixture()
  const objectives = repositories.ObjectiveRepository as ObjectiveRepository

  const before = await objectives.get(TENANT_A, seeds[TENANT_A].objective)
  const revisionsBefore = store.rawDump(TENANT_A, 'qs_content_revisions').filter((row) => row.record_id === before.id).length

  await assert.rejects(
    objectives.setOwner(TENANT_A, seeds[TENANT_A].objective, seeds[TENANT_B].entity, { actorId: 'principal-a' }),
    (error: unknown) => {
      assert.equal(code(error), 'CrossTenantRelation')
      return true
    },
  )

  const after = await objectives.get(TENANT_A, seeds[TENANT_A].objective)
  assert.equal(after.owner_id, before.owner_id, 'the relation must not be written')
  assert.equal(after.revision, before.revision, 'the source revision must not move')
  assert.equal(
    store.rawDump(TENANT_A, 'qs_content_revisions').filter((row) => row.record_id === before.id).length,
    revisionsBefore,
    'no revision or audit row may be appended on a refusal',
  )
  assert.equal(store.rawDump(TENANT_B, 'qs_entities').length, 1, 'the other tenant is unchanged')

  // Positive control: the same write to a same-tenant target succeeds.
  const linked = await objectives.setOwner(TENANT_A, seeds[TENANT_A].objective, seeds[TENANT_A].entity, { actorId: 'principal-a' })
  assert.equal(linked.owner_id, seeds[TENANT_A].entity)
  assert.equal(linked.revision, before.revision + 1)
})

const actor = { actorId: 'principal-a' }

test('C1-B06 a join-table endpoint in another tenant is refused and writes no join row', async () => {
  const { repositories, seeds, store } = seededFixture()
  const departments = repositories.DepartmentRepository as unknown as DepartmentRepository
  const capabilities = repositories.CapabilityRepository as unknown as CapabilityRepository
  const entities = repositories.EntityRepository

  const departmentBefore = await departments.get(TENANT_A, seeds[TENANT_A].department)
  const entityBefore = await entities.get(TENANT_B, seeds[TENANT_B].entity)

  await assert.rejects(
    departments.addMember(TENANT_A, seeds[TENANT_A].department, seeds[TENANT_B].entity, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )
  assert.equal(store.rawDump(TENANT_A, 'qs_department_members').length, 0, 'no join row may be inserted')
  assert.equal((await departments.get(TENANT_A, seeds[TENANT_A].department)).revision, departmentBefore.revision)
  assert.equal((await entities.get(TENANT_B, seeds[TENANT_B].entity)).revision, entityBefore.revision)

  await assert.rejects(
    capabilities.authorizeEntity(TENANT_A, seeds[TENANT_A].capability, seeds[TENANT_B].entity, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )
  assert.equal(store.rawDump(TENANT_A, 'qs_entity_capabilities').length, 0)

  // Positive controls, including a repeated link that must not duplicate the row.
  await departments.addMember(TENANT_A, seeds[TENANT_A].department, seeds[TENANT_A].entity, actor)
  await departments.addMember(TENANT_A, seeds[TENANT_A].department, seeds[TENANT_A].entity, actor)
  assert.equal(store.rawDump(TENANT_A, 'qs_department_members').length, 1)
  await capabilities.authorizeEntity(TENANT_A, seeds[TENANT_A].capability, seeds[TENANT_A].entity, actor)
  assert.equal(store.rawDump(TENANT_A, 'qs_entity_capabilities').length, 1)
})

test('C1-B07 a typed decision-context target in another tenant is refused and appends no event', async () => {
  const { repositories, seeds, store } = seededFixture()
  const decisions = repositories.DecisionRepository as unknown as DecisionRepository
  const eventsBefore = store.rawDump(TENANT_A, 'qs_decision_events').length

  for (const target of [
    { entityId: seeds[TENANT_B].entity },
    { capabilityId: seeds[TENANT_B].capability },
    { policyId: seeds[TENANT_B].policy },
  ]) {
    await assert.rejects(
      decisions.setContext(TENANT_A, seeds[TENANT_A].decision, target, actor),
      (error: unknown) => code(error) === 'CrossTenantRelation',
    )
  }

  assert.equal(store.rawDump(TENANT_A, 'qs_decision_events').length, eventsBefore, 'a refusal appends no decision event')
  const unchanged = await decisions.get(TENANT_A, seeds[TENANT_A].decision)
  assert.equal(unchanged.context_entity_id, null)
  assert.equal(unchanged.context_capability_id, null)
  assert.equal(unchanged.context_policy_id, null)

  // Positive control: exactly one target type is set, and exactly one event lands.
  const linked = await decisions.setContext(TENANT_A, seeds[TENANT_A].decision, { entityId: seeds[TENANT_A].entity }, actor)
  assert.equal(linked.context_entity_id, seeds[TENANT_A].entity)
  assert.equal(linked.context_capability_id, null)
  assert.equal(linked.context_policy_id, null)
  assert.equal(store.rawDump(TENANT_A, 'qs_decision_events').length, eventsBefore + 1)
})

test('C1-B08 a publication head cannot point at another tenant’s version', async () => {
  const { repositories, seeds, store } = seededFixture()
  const workflowHeads = repositories.WorkflowPublicationHeadRepository as unknown as WorkflowPublicationHeadRepository
  const agentHeads = repositories.AgentPublicationHeadRepository as unknown as AgentPublicationHeadRepository

  const workflowAuditsBefore = store.rawDump(TENANT_A, 'qs_workflow_publication_audits').length
  const agentAuditsBefore = store.rawDump(TENANT_A, 'qs_agent_publication_audits').length

  // Tenant B holds version 2 of the same graph and agent; tenant A does not.
  await assert.rejects(
    workflowHeads.cas(TENANT_A, COLLIDING_KEYS.graphId, 1, 2, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )
  await assert.rejects(
    agentHeads.cas(TENANT_A, COLLIDING_KEYS.agentId, 1, 2, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )

  const workflowHead = await workflowHeads.get(TENANT_A, seeds[TENANT_A].workflowHead)
  assert.equal(workflowHead.cas_revision, 1)
  assert.equal(workflowHead.active_version, 1)
  const agentHead = await agentHeads.get(TENANT_A, seeds[TENANT_A].agentHead)
  assert.equal(agentHead.cas_revision, 1)
  assert.equal(agentHead.active_version, 1)
  assert.equal(store.rawDump(TENANT_A, 'qs_workflow_publication_audits').length, workflowAuditsBefore)
  assert.equal(store.rawDump(TENANT_A, 'qs_agent_publication_audits').length, agentAuditsBefore)

  // A stale CAS value is a conflict, not a move.
  await assert.rejects(
    workflowHeads.cas(TENANT_A, COLLIDING_KEYS.graphId, 99, 1, actor),
    (error: unknown) => code(error) === 'RevisionConflict',
  )

  // Positive controls: each head moves once, with exactly one audit row.
  const moved = await workflowHeads.cas(TENANT_A, COLLIDING_KEYS.graphId, 1, 1, actor)
  assert.equal(moved.cas_revision, 2)
  assert.equal(moved.active_version, 1)
  assert.equal(store.rawDump(TENANT_A, 'qs_workflow_publication_audits').length, workflowAuditsBefore + 1)
  const agentMoved = await agentHeads.cas(TENANT_A, COLLIDING_KEYS.agentId, 1, 1, actor)
  assert.equal(agentMoved.cas_revision, 2)
  assert.equal(store.rawDump(TENANT_A, 'qs_agent_publication_audits').length, agentAuditsBefore + 1)
})

test('C1-B09 every operator link refuses a target in another tenant', async () => {
  const { repositories, seeds, store } = seededFixture()
  const commitments = repositories.CommitmentRepository as unknown as CommitmentRepository
  const scheduled = repositories.ScheduledItemRepository as unknown as ScheduledItemRepository
  const drafts = repositories.DraftedCommunicationRepository as unknown as DraftedCommunicationRepository

  const snapshot = JSON.stringify(
    store
      .tableNames()
      .map((table) => [table, store.rows(table).filter((row) => row.tenant_id === TENANT_A).length]),
  )

  await assert.rejects(
    commitments.linkDecision(TENANT_A, seeds[TENANT_A].commitment, seeds[TENANT_B].decision, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )
  await assert.rejects(
    scheduled.linkCommitment(TENANT_A, seeds[TENANT_A].scheduledItem, seeds[TENANT_B].commitment, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )
  await assert.rejects(
    scheduled.linkDecision(TENANT_A, seeds[TENANT_A].scheduledItem, seeds[TENANT_B].decision, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )
  await assert.rejects(
    scheduled.linkContact(TENANT_A, seeds[TENANT_A].scheduledItem, seeds[TENANT_B].contacts[0]!, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )
  await assert.rejects(
    drafts.linkContact(TENANT_A, seeds[TENANT_A].draft, seeds[TENANT_B].contacts[0]!, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )
  await assert.rejects(
    drafts.linkCommitment(TENANT_A, seeds[TENANT_A].draft, seeds[TENANT_B].commitment, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )
  await assert.rejects(
    drafts.linkDecision(TENANT_A, seeds[TENANT_A].draft, seeds[TENANT_B].decision, actor),
    (error: unknown) => code(error) === 'CrossTenantRelation',
  )

  const after = JSON.stringify(
    store
      .tableNames()
      .map((table) => [table, store.rows(table).filter((row) => row.tenant_id === TENANT_A).length]),
  )
  assert.equal(after, snapshot, 'no refusal may change a row, join, revision or audit count')

  // Positive controls: each link succeeds against a same-tenant target.
  await commitments.linkDecision(TENANT_A, seeds[TENANT_A].commitment, seeds[TENANT_A].decision, actor)
  await scheduled.linkCommitment(TENANT_A, seeds[TENANT_A].scheduledItem, seeds[TENANT_A].commitment, actor)
  await drafts.linkContact(TENANT_A, seeds[TENANT_A].draft, seeds[TENANT_A].contacts[0]!, actor)
  assert.equal((await commitments.get(TENANT_A, seeds[TENANT_A].commitment)).linked_decision_id, seeds[TENANT_A].decision)
  assert.equal((await drafts.get(TENANT_A, seeds[TENANT_A].draft)).contact_id, seeds[TENANT_A].contacts[0])
})

test('C1-B10 every query contract returns its empty result for a foreign id and never writes', async () => {
  const { seeds, store } = seededFixture()
  const counts = JSON.stringify(store.tableNames().map((table) => [table, store.rows(table).length]))

  const graphA = await getCapabilityGraph(store, TENANT_A)
  const aNodeIds = graphA.nodes.map((node) => node.id)
  assert.deepEqual(aNodeIds, [seeds[TENANT_A].capability, seeds[TENANT_A].capability2].sort())
  assert.ok(!aNodeIds.includes(seeds[TENANT_B].capability))
  assert.deepEqual(graphA.edges, [{ from: seeds[TENANT_A].capability, to: seeds[TENANT_A].capability2, kind: 'inherits' }])

  const findings = await findContradictions(store, TENANT_A)
  assert.equal(findings.length, 1)
  assert.ok(findings[0]!.subjectIds.includes(seeds[TENANT_A].evidence))
  assert.ok(!findings[0]!.subjectIds.includes(seeds[TENANT_B].evidence))

  assert.equal(await getWorkflowDAG(store, TENANT_A, FOREIGN_GRAPH), null, 'a foreign graph is not resolved')
  assert.ok(await getWorkflowDAG(store, TENANT_A, COLLIDING_KEYS.graphId), 'the same-tenant graph resolves')
  assert.deepEqual(await getObjectiveTree(store, TENANT_A, seeds[TENANT_B].objective), { roots: [], truncated: false })
  assert.deepEqual(await getEvidenceForMetric(store, TENANT_A, seeds[TENANT_B].metric), [])
  assert.deepEqual((await getDecisionHistory(store, TENANT_A, { decisionId: seeds[TENANT_B].decision })).events, [])

  assert.equal(
    JSON.stringify(store.tableNames().map((table) => [table, store.rows(table).length])),
    counts,
    'a query may not write',
  )
})

test('C1-B11 every inventory relation has a same-tenant success and a cross-tenant refusal', () => {
  const { store, seeds } = seededFixture()

  for (const relation of RELATION_INVENTORY) {
    const sourceA = rowFor(seeds, relation.sourceTable, TENANT_A)
    const targetA = rowFor(seeds, relation.targetTable, TENANT_A)
    const targetB = rowFor(seeds, relation.targetTable, TENANT_B)
    const joins = () =>
      relation.joinTable ? store.rows(relation.joinTable).filter((row) => row.tenant_id === TENANT_A).length : 0

    const before = joins()
    linkRelation(store, TENANT_A, relation, sourceA, targetA, { actorId: 'principal-a' })
    if (relation.joinTable) assert.equal(joins(), before + 1, `${relation.id}: a same-tenant link inserts one join row`)

    assert.throws(
      () => linkRelation(store, TENANT_A, relation, sourceA, targetB, { actorId: 'principal-a' }),
      (error: unknown) => code(error) === 'CrossTenantRelation',
      `${relation.id}: a foreign target must be refused`,
    )
    assert.equal(joins(), relation.joinTable ? before + 1 : 0, `${relation.id}: a refusal inserts no join row`)
  }

  assert.ok(RELATION_INVENTORY.length >= 50, 'the inventory must cover the §6 content relations')
})
