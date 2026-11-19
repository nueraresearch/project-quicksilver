/**
 * Gate C — revisions and optimistic concurrency (matrix §5), C01–C08.
 *
 * A write states the revision it expects; a mismatch touches nothing. Every
 * refusal is paired with a successful same-shape write so a repository that
 * refuses all updates cannot pass.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RepositoryError } from '../../cms/errors.ts'
import type { OrganizationRepository } from '../../cms/repositories.ts'
import { TENANT_A, seededFixture } from './fixtures/two-tenants.ts'

const actor = { actorId: 'principal-a' }

function code(error: unknown): string | undefined {
  return error instanceof RepositoryError ? error.code : undefined
}

test('C1-C01 an update with a stale expectedRevision is a conflict and changes nothing', async () => {
  const { store, repositories } = seededFixture()
  const organizations = repositories.OrganizationRepository as unknown as OrganizationRepository
  const before = await organizations.get(TENANT_A, (await organizations.getRoot(TENANT_A)).id)
  const revisionsBefore = store.rawDump(TENANT_A, 'qs_content_revisions').length

  await assert.rejects(
    organizations.update(TENANT_A, before.id, { name: 'Changed' }, { ...actor, expectedRevision: 0 }),
    (error: unknown) => code(error) === 'RevisionConflict',
  )

  const after = await organizations.get(TENANT_A, before.id)
  assert.equal(after.name, before.name)
  assert.equal(after.revision, before.revision)
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, revisionsBefore)
})

test('C1-C02 two writers at the same revision produce one winner and one conflict', async () => {
  const { store, repositories } = seededFixture()
  const organizations = repositories.OrganizationRepository as unknown as OrganizationRepository
  const target = await organizations.getRoot(TENANT_A)
  const revisionsBefore = store.rawDump(TENANT_A, 'qs_content_revisions').length
  const barrier = store.barrier(2)

  const attempt = (name: string) =>
    (async () => {
      await barrier.wait()
      return organizations.update(TENANT_A, target.id, { name }, { ...actor, expectedRevision: target.revision })
    })()

  const results = await Promise.allSettled([attempt('Writer One'), attempt('Writer Two')])
  const fulfilled = results.filter((result) => result.status === 'fulfilled')
  const rejected = results.filter((result) => result.status === 'rejected')

  assert.equal(fulfilled.length, 1, 'exactly one writer may win')
  assert.equal(rejected.length, 1)
  assert.equal(code((rejected[0] as PromiseRejectedResult).reason), 'RevisionConflict')

  const winner = (fulfilled[0] as PromiseFulfilledResult<{ name: string }>).value
  const stored = await organizations.get(TENANT_A, target.id, { includeDraft: true })
  assert.equal(stored.revision, target.revision + 1, 'the revision advances exactly once')
  assert.equal(stored.name, winner.name, 'the stored row is the winner')
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, revisionsBefore + 1, 'one new revision row')
})

test('C1-C03 publishing an older revision than the current one is a conflict', async () => {
  const { store, repositories } = seededFixture()
  const organizations = repositories.OrganizationRepository as unknown as OrganizationRepository
  const target = await organizations.getRoot(TENANT_A)

  const published = await organizations.publish(TENANT_A, target.id, 1, { ...actor, expectedRevision: 1 })
  assert.equal(published.published_revision, 1)
  const advanced = await organizations.update(TENANT_A, target.id, { name: 'Draft two' }, { ...actor, expectedRevision: 1 })
  assert.equal(advanced.revision, 2)

  const revisionsBefore = store.rawDump(TENANT_A, 'qs_content_revisions').length
  await assert.rejects(
    organizations.publish(TENANT_A, target.id, 1, { ...actor, expectedRevision: 1 }),
    (error: unknown) => code(error) === 'RevisionConflict',
  )
  const after = await organizations.get(TENANT_A, target.id, { includeDraft: true })
  assert.equal(after.published_revision, 1, 'the published pointer does not move')
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, revisionsBefore, 'no revision is appended')
})

test('C1-C04 archive, soft delete and restore each refuse a stale revision', async () => {
  const { store, repositories } = seededFixture()
  const organizations = repositories.OrganizationRepository as unknown as OrganizationRepository
  const created = await organizations.getRoot(TENANT_A)
  const current = await organizations.update(TENANT_A, created.id, { name: 'Revision two' }, { ...actor, expectedRevision: 1 })
  const revisionsBefore = store.rawDump(TENANT_A, 'qs_content_revisions').length

  for (const operation of ['archive', 'softDelete', 'restore'] as const) {
    await assert.rejects(
      organizations[operation](TENANT_A, current.id, { ...actor, expectedRevision: 1 }),
      (error: unknown) => code(error) === 'RevisionConflict',
      `${operation} must refuse a stale revision`,
    )
  }

  const after = await organizations.get(TENANT_A, current.id, { includeDraft: true })
  assert.equal(after.lifecycle, current.lifecycle)
  assert.equal(after.deleted_at, undefined)
  assert.equal(after.published_revision, undefined)
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, revisionsBefore)
})

test('C1-C05 an update without expectedRevision is MalformedQuery, and the positive control succeeds', async () => {
  const { repositories } = seededFixture()
  const organizations = repositories.OrganizationRepository as unknown as OrganizationRepository
  const target = await organizations.getRoot(TENANT_A)

  await assert.rejects(
    organizations.update(TENANT_A, target.id, { name: 'No expectation' }, actor as never),
    (error: unknown) => code(error) === 'MalformedQuery',
  )
  const updated = await organizations.update(TENANT_A, target.id, { name: 'Expected' }, { ...actor, expectedRevision: 1 })
  assert.equal(updated.name, 'Expected')
  assert.equal(updated.revision, 2)
})

test('C1-C06 revision 1 stays immutable while the published read keeps returning it', async () => {
  const { repositories } = seededFixture()
  const organizations = repositories.OrganizationRepository as unknown as OrganizationRepository
  const target = await organizations.getRoot(TENANT_A)
  await organizations.publish(TENANT_A, target.id, 1, { ...actor, expectedRevision: 1 })

  const revisionOne = await organizations.getRevision(TENANT_A, target.id, 1)
  const digestOne = (await organizations.revisions(TENANT_A, target.id, { limit: 10 })).items.find(
    (item) => item.revision === 1,
  )?.digest
  assert.ok(digestOne)

  const updated = await organizations.update(TENANT_A, target.id, { name: 'Revision two' }, { ...actor, expectedRevision: 1 })
  assert.equal(updated.revision, 2)

  const publishedRead = await organizations.get(TENANT_A, target.id)
  assert.equal(publishedRead.revision, 1, 'the default read is the published revision')
  assert.equal((publishedRead as { name: string }).name, (revisionOne as { name: string }).name)

  const draftRead = await organizations.get(TENANT_A, target.id, { includeDraft: true })
  assert.equal(draftRead.revision, 2)
  assert.equal((draftRead as { name: string }).name, 'Revision two')

  const revisionOneAgain = await organizations.getRevision(TENANT_A, target.id, 1)
  assert.deepEqual(revisionOneAgain, revisionOne, 'revision 1 is unchanged')
  const revisions = (await organizations.revisions(TENANT_A, target.id, { limit: 10 })).items
  const digestTwo = revisions.find((item) => item.revision === 2)?.digest
  assert.notEqual(digestTwo, digestOne, 'revision 2 has a new digest')
})

test('C1-C07 two head CAS moves at the same casRevision produce one winner and one audit row', async () => {
  const { store, repositories } = seededFixture()
  const heads = repositories.WorkflowPublicationHeadRepository as unknown as {
    cas(tenantId: string, graphId: string, expected: number, version: number, options: { actorId: string }): Promise<{ cas_revision: number; active_version: number }>
  }
  const auditsBefore = store.rawDump(TENANT_A, 'qs_workflow_publication_audits').length
  const barrier = store.barrier(2)
  const move = () =>
    (async () => {
      await barrier.wait()
      return heads.cas(TENANT_A, 'shared-graph', 1, 1, actor)
    })()

  const results = await Promise.allSettled([move(), move()])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejection = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
  assert.equal(code(rejection.reason), 'RevisionConflict')

  const head = await heads.cas(TENANT_A, 'shared-graph', 2, 1, actor)
  assert.equal(head.cas_revision, 3, 'each successful move advances the CAS revision once')
  assert.equal(store.rawDump(TENANT_A, 'qs_workflow_publication_audits').length, auditsBefore + 2)
})

test('C1-C08 an append-only store refuses update and hard delete', async () => {
  const { store, repositories } = seededFixture()
  const audits = repositories.DepartmentAuditRepository as unknown as {
    update(...args: unknown[]): Promise<unknown>
    hardDelete(...args: unknown[]): Promise<unknown>
  }
  store.insert('qs_department_execution_audits', {
    tenant_id: TENANT_A,
    id: 'audit-1',
    department_id: 'dep-1',
    action: 'execute',
    executed_at: '2026-01-01T00:00:00.000Z',
  })
  const before = JSON.stringify(store.rawDump(TENANT_A, 'qs_department_execution_audits'))

  await assert.rejects(audits.update(), (error: unknown) => code(error) === 'AppendOnlyViolation')
  await assert.rejects(audits.hardDelete(), (error: unknown) => code(error) === 'AppendOnlyViolation')
  assert.equal(JSON.stringify(store.rawDump(TENANT_A, 'qs_department_execution_audits')), before)
})
