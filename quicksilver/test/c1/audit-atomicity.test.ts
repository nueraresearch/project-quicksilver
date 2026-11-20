/**
 * Gate E — a failed audit/evidence append aborts the whole mutation (matrix §7),
 * C1-E01–C1-E08.
 *
 * The seam fails the obligation, not the primary write, so a case proves the
 * abort rather than a caller checking the fault first. Each refusal is paired
 * with the same mutation succeeding in E08.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RepositoryError } from '../../cms/errors.ts'
import type {
  ContentRecord,
  DepartmentAuditRepository,
  MetricRepository,
  OrganizationRepository,
  WorkflowPublicationHeadRepository,
} from '../../cms/repositories.ts'
import { TENANT_A, freshFixture, seededFixture } from './fixtures/two-tenants.ts'

const actor = { actorId: 'principal-a' }

function code(error: unknown): string | undefined {
  return error instanceof RepositoryError ? error.code : undefined
}

test('C1-E01 a create whose revision append fails leaves no record, revision, key or audit', async () => {
  const { store, repositories } = freshFixture()
  const organizations = repositories.OrganizationRepository as unknown as OrganizationRepository
  store.failAuditAppend('content.create', 'qs_content_revisions')

  await assert.rejects(
    organizations.createIdempotent(TENANT_A, { name: 'Doomed org' }, { ...actor, idempotencyKey: 'k-e01' }),
    (error: unknown) => code(error) === 'AuditWriteFailed',
  )

  assert.equal(store.rawDump(TENANT_A, 'qs_organizations').length, 0, 'no current row')
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, 0, 'no revision')
  assert.equal(store.rawDump(TENANT_A, 'qs_idempotency_keys').length, 0, 'no idempotency key')
})

test('C1-E02 an update whose revision append fails changes no row, revision or digest', async () => {
  const { store, repositories } = seededFixture()
  const organizations = repositories.OrganizationRepository as unknown as OrganizationRepository
  const target = await organizations.getRoot(TENANT_A)
  const before = await organizations.get(TENANT_A, target.id, { includeDraft: true })
  const digestsBefore = (await organizations.revisions(TENANT_A, target.id, { limit: 10 })).items.map((item) => item.digest)
  store.failAuditAppend('content.update', 'qs_content_revisions')

  await assert.rejects(
    organizations.update(TENANT_A, target.id, { name: 'Should not land' }, { ...actor, expectedRevision: 1 }),
    (error: unknown) => code(error) === 'AuditWriteFailed',
  )

  assert.deepEqual(await organizations.get(TENANT_A, target.id, { includeDraft: true }), before, 'the row is unchanged')
  const after = await organizations.revisions(TENANT_A, target.id, { limit: 10 })
  assert.deepEqual(after.items.map((item) => item.digest), digestsBefore, 'no revision or digest changed')
})

test('C1-E03 publish, archive, soft delete and restore each abort on a failed append', async () => {
  const operations = [
    { name: 'publish', fault: 'content.publish' },
    { name: 'archive', fault: 'content.archive' },
    { name: 'softDelete', fault: 'content.delete' },
    { name: 'restore', fault: 'content.restore' },
  ] as const

  for (const operation of operations) {
    const { store, repositories } = seededFixture()
    const organizations = repositories.OrganizationRepository as unknown as OrganizationRepository
    const target = await organizations.getRoot(TENANT_A)
    const before = await organizations.get(TENANT_A, target.id, { includeDraft: true })
    const revisionsBefore = store.rawDump(TENANT_A, 'qs_content_revisions').length
    store.failAuditAppend(operation.fault, 'qs_content_revisions')

    const call =
      operation.name === 'publish'
        ? organizations.publish(TENANT_A, target.id, 1, { ...actor, expectedRevision: 1 })
        : organizations[operation.name](TENANT_A, target.id, { ...actor, expectedRevision: 1 })

    await assert.rejects(call, (error: unknown) => code(error) === 'AuditWriteFailed', `${operation.name} aborts`)

    const after = await organizations.get(TENANT_A, target.id, { includeDraft: true })
    assert.deepEqual(after, before, `${operation.name}: row unchanged`)
    assert.equal(after.published_revision, undefined, `${operation.name}: no publish pointer`)
    assert.equal(after.deleted_at, undefined, `${operation.name}: no tombstone`)
    assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, revisionsBefore, `${operation.name}: no revision`)
  }
})

test('C1-E04 a failed decision event append leaves the projection and hash chain alone', async () => {
  const { store, seeds, repositories } = seededFixture()
  const decisions = repositories.DecisionRepository as unknown as {
    setContext(tenantId: string, id: string, target: { entityId?: string }, options: { actorId: string }): Promise<ContentRecord>
  }
  const decisionId = seeds[TENANT_A].decision
  const eventsBefore = store.rawDump(TENANT_A, 'qs_decision_events').filter((row) => row.decision_id === decisionId)
  assert.equal(eventsBefore.length, 1)
  const chainHead = eventsBefore[0]?.hash
  store.failAuditAppend('decision.event', 'qs_decision_events')

  await assert.rejects(
    decisions.setContext(TENANT_A, decisionId, { entityId: seeds[TENANT_A].entity }, actor),
    (error: unknown) => code(error) === 'AuditWriteFailed',
  )

  const decision = store.rawDump(TENANT_A, 'qs_decisions').find((row) => row.id === decisionId)!
  assert.equal(decision.context_entity_id, null, 'no context projection change')
  assert.equal(decision.revision, 1, 'no revision')
  const eventsAfter = store.rawDump(TENANT_A, 'qs_decision_events').filter((row) => row.decision_id === decisionId)
  assert.equal(eventsAfter.length, 1, 'no event')
  assert.equal(eventsAfter[0]?.hash, chainHead, 'the chain is not extended')

  await decisions.setContext(TENANT_A, decisionId, { entityId: seeds[TENANT_A].entity }, actor)
  const eventsLinked = store.rawDump(TENANT_A, 'qs_decision_events').filter((row) => row.decision_id === decisionId)
  assert.equal(eventsLinked.length, 2, 'the successful append writes exactly one event')
  assert.equal(eventsLinked[1]?.prev_hash, chainHead, 'the new event links to the chain head')
})

test('C1-E05 a failed observation append leaves the metric at its old value', async () => {
  const { store, seeds, repositories } = seededFixture()
  const metrics = repositories.MetricRepository as unknown as MetricRepository
  const metricId = seeds[TENANT_A].metric
  store.failAuditAppend('metric.observe', 'qs_metric_observations')

  await assert.rejects(metrics.observe(TENANT_A, metricId, 12, actor), (error: unknown) => code(error) === 'AuditWriteFailed')

  assert.equal(store.rawDump(TENANT_A, 'qs_metric_observations').length, 0, 'no observation')
  const metric = await metrics.get(TENANT_A, metricId, { includeDraft: true })
  assert.equal(metric.value, 10, 'the current value is unchanged')
  assert.equal(metric.revision, 1, 'the revision is unchanged')

  await metrics.observe(TENANT_A, metricId, 12, actor)
  assert.equal(store.rawDump(TENANT_A, 'qs_metric_observations').length, 1, 'the retry writes one observation')
  assert.equal((await metrics.get(TENANT_A, metricId, { includeDraft: true })).value, 12)
})

test('C1-E06 a failed publication audit append leaves the head at its old CAS revision', async () => {
  const { store, repositories } = seededFixture()
  const heads = repositories.WorkflowPublicationHeadRepository as unknown as WorkflowPublicationHeadRepository
  store.failAuditAppend('publication.cas', 'qs_workflow_publication_audits')

  await assert.rejects(
    heads.cas(TENANT_A, 'shared-graph', 1, 1, actor),
    (error: unknown) => code(error) === 'AuditWriteFailed',
  )

  const head = store
    .rawDump(TENANT_A, 'qs_workflow_publication_heads')
    .find((row) => row.graph_id === 'shared-graph')!
  assert.equal(head.cas_revision, 1, 'casRevision stays 1')
  assert.equal(head.active_version, 1, 'activeVersion stays 1')
  assert.equal(store.rawDump(TENANT_A, 'qs_workflow_publication_audits').length, 0, 'no audit row')

  const moved = await heads.cas(TENANT_A, 'shared-graph', 1, 1, actor)
  assert.equal(moved.cas_revision, 2)
  assert.equal(store.rawDump(TENANT_A, 'qs_workflow_publication_audits').length, 1, 'the retry appends once')
})

test('C1-E07 a specialized audit append surfaces its failure and appends once on retry', async () => {
  const { store, repositories } = seededFixture()
  const audits = repositories.DepartmentAuditRepository as unknown as DepartmentAuditRepository
  store.failAuditAppend('department.execution-audit', 'qs_department_execution_audits')

  await assert.rejects(
    audits.append(TENANT_A, { department_id: 'dep-1', action: 'execute', status: 'executed' }, actor),
    (error: unknown) => code(error) === 'AuditWriteFailed',
    'the error is surfaced, not swallowed',
  )
  assert.equal(store.rawDump(TENANT_A, 'qs_department_execution_audits').length, 0, 'the list is unchanged')

  await audits.append(TENANT_A, { department_id: 'dep-1', action: 'execute', status: 'executed' }, actor)
  assert.equal(store.rawDump(TENANT_A, 'qs_department_execution_audits').length, 1, 'one append on retry')
})

test('C1-E08 each successful mutation commits exactly one audit or evidence row', async () => {
  // Content lifecycle on an empty tenant.
  const empty = freshFixture()
  const organizations = empty.repositories.OrganizationRepository as unknown as OrganizationRepository
  const created = await organizations.createIdempotent(TENANT_A, { name: 'Atomic org' }, { ...actor, idempotencyKey: 'k-e08' })
  assert.equal(empty.store.rawDump(TENANT_A, 'qs_organizations').length, 1)
  assert.equal(empty.store.rawDump(TENANT_A, 'qs_content_revisions').length, 1)
  assert.equal(empty.store.rawDump(TENANT_A, 'qs_idempotency_keys').length, 1)

  const updated = await organizations.update(TENANT_A, created.id, { name: 'Atomic org two' }, { ...actor, expectedRevision: 1 })
  const revisions = (await organizations.revisions(TENANT_A, created.id, { limit: 10 })).items
  assert.deepEqual(revisions.map((item) => item.revision), [2, 1], 'one revision row per revision, no duplicate')

  const published = await organizations.publish(TENANT_A, created.id, updated.revision, { ...actor, expectedRevision: 2 })
  assert.equal(published.published_revision, 2)
  const afterPublish = (await organizations.revisions(TENANT_A, created.id, { limit: 10 })).items
  assert.deepEqual(afterPublish.map((item) => item.revision), [2, 1], 'publishing marks a row instead of adding one')

  // Decision event, metric observation and head audit on the seeded tenant.
  const { store, seeds, repositories } = seededFixture()
  const decisions = repositories.DecisionRepository as unknown as {
    setContext(tenantId: string, id: string, target: { entityId?: string }, options: { actorId: string }): Promise<ContentRecord>
  }
  const metrics = repositories.MetricRepository as unknown as MetricRepository
  const heads = repositories.WorkflowPublicationHeadRepository as unknown as WorkflowPublicationHeadRepository

  const eventsBefore = store.rawDump(TENANT_A, 'qs_decision_events').length
  await decisions.setContext(TENANT_A, seeds[TENANT_A].decision, { entityId: seeds[TENANT_A].entity }, actor)
  assert.equal(store.rawDump(TENANT_A, 'qs_decision_events').length, eventsBefore + 1, 'exactly one event')

  await metrics.observe(TENANT_A, seeds[TENANT_A].metric, 12, actor)
  assert.equal(store.rawDump(TENANT_A, 'qs_metric_observations').length, 1, 'exactly one observation')

  const auditsBefore = store.rawDump(TENANT_A, 'qs_workflow_publication_audits').length
  await heads.cas(TENANT_A, 'shared-graph', 1, 1, actor)
  assert.equal(store.rawDump(TENANT_A, 'qs_workflow_publication_audits').length, auditsBefore + 1, 'exactly one audit')
})
