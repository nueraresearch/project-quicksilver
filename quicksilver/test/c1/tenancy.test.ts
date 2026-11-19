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
import type { ObjectiveRepository } from '../../cms/repositories.ts'
import { COLLIDING_KEYS, TENANT_A, TENANT_B, seededFixture } from './fixtures/two-tenants.ts'

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
