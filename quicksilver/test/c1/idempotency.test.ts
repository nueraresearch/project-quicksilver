/**
 * Gate D — idempotency (matrix §6), C1-D01–C1-D06.
 *
 * Replays return the first response instead of re-running the write; a
 * different request under the same key conflicts; a failed transaction leaves
 * no key for the retry to trip over.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RepositoryError } from '../../cms/errors.ts'
import { findIdempotencyKey } from '../../cms/idempotency.ts'
import type { OrganizationRepository } from '../../cms/repositories.ts'
import { digestOf } from '../../cms/store.ts'
import { TENANT_A, TENANT_B, freshFixture, seededFixture } from './fixtures/two-tenants.ts'

const actor = { actorId: 'principal-a' }
const input = { name: 'Idempotent org', slug: 'idempotent-org' }

function code(error: unknown): string | undefined {
  return error instanceof RepositoryError ? error.code : undefined
}

function organizationsOf(repositories: Record<string, unknown>): OrganizationRepository {
  return repositories.OrganizationRepository as unknown as OrganizationRepository
}

test('C1-D01 the same create request under one key returns the first record once', async () => {
  const { store, repositories } = freshFixture()
  const organizations = organizationsOf(repositories)

  const first = await organizations.createIdempotent(TENANT_A, input, { ...actor, idempotencyKey: 'k-create' })
  const second = await organizations.createIdempotent(TENANT_A, input, { ...actor, idempotencyKey: 'k-create' })

  assert.equal(second.id, first.id)
  assert.equal(second.revision, first.revision)
  const key = findIdempotencyKey(store, TENANT_A, 'create', 'k-create')
  assert.ok(key, 'the key is recorded')
  assert.equal(String(key.response_digest), digestOf(first), 'the replay carries the first response digest')
  assert.equal(String(key.record_id), first.id)

  assert.equal(store.rawDump(TENANT_A, 'qs_organizations').length, 1, 'one row')
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, 1, 'one revision')
  assert.equal(store.rawDump(TENANT_A, 'qs_idempotency_keys').length, 1, 'one key')
})

test('C1-D02 the same key with a different payload is a conflict and writes nothing', async () => {
  const { store, repositories } = freshFixture()
  const organizations = organizationsOf(repositories)
  const original = await organizations.createIdempotent(TENANT_A, input, { ...actor, idempotencyKey: 'k-create' })

  await assert.rejects(
    organizations.createIdempotent(TENANT_A, { ...input, name: 'Different org' }, { ...actor, idempotencyKey: 'k-create' }),
    (error: unknown) => code(error) === 'IdempotencyConflict',
  )

  assert.equal(store.rawDump(TENANT_A, 'qs_organizations').length, 1, 'no second record')
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, 1, 'no second revision')
  assert.equal((await organizations.get(TENANT_A, original.id)).name, input.name, 'the original is unchanged')
})

test('C1-D03 the same operation and key in two tenants are independent and invisible to each other', async () => {
  const { store, repositories } = freshFixture()
  const organizations = organizationsOf(repositories)

  const a = await organizations.createIdempotent(TENANT_A, input, { ...actor, idempotencyKey: 'k-shared' })
  const b = await organizations.createIdempotent(TENANT_B, input, { ...actor, idempotencyKey: 'k-shared' })

  assert.notEqual(b.id, a.id, 'each tenant gets its own record')
  assert.equal((await organizations.get(TENANT_A, a.id)).tenant_id, TENANT_A)
  assert.equal((await organizations.get(TENANT_B, b.id)).tenant_id, TENANT_B)
  await assert.rejects(
    organizations.get(TENANT_B, a.id),
    (error: unknown) => code(error) === 'NotFound',
    'A’s record is not resolvable from B',
  )

  assert.equal(store.rawDump(TENANT_A, 'qs_idempotency_keys').length, 1)
  assert.equal(store.rawDump(TENANT_B, 'qs_idempotency_keys').length, 1)
  const keyA = findIdempotencyKey(store, TENANT_A, 'create', 'k-shared')
  const keyB = findIdempotencyKey(store, TENANT_B, 'create', 'k-shared')
  assert.notEqual(keyA?.id, keyB?.id, 'neither key row is shared')
  assert.equal(String(keyA?.record_id), a.id)
  assert.equal(String(keyB?.record_id), b.id)
})

test('C1-D04 two concurrent creates with the same key write once and both get the same record', async () => {
  const { store, repositories } = freshFixture()
  const organizations = organizationsOf(repositories)
  const barrier = store.barrier(2)

  const attempt = () =>
    (async () => {
      await barrier.wait()
      return organizations.createIdempotent(TENANT_A, input, { ...actor, idempotencyKey: 'k-race' })
    })()

  const [first, second] = await Promise.all([attempt(), attempt()])

  assert.equal(second.id, first.id, 'both callers receive the same record id')
  assert.equal(second.revision, first.revision)
  const key = findIdempotencyKey(store, TENANT_A, 'create', 'k-race')
  assert.equal(String(key?.record_id), first.id)
  assert.equal(store.rawDump(TENANT_A, 'qs_organizations').length, 1, 'exactly one row')
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, 1, 'exactly one revision')
  assert.equal(store.rawDump(TENANT_A, 'qs_idempotency_keys').length, 1, 'exactly one key')
})

test('C1-D05 a create that fails before commit leaves no key and its retry succeeds', async () => {
  const { store, repositories } = freshFixture()
  const organizations = organizationsOf(repositories)
  store.failAuditAppend('content.create', 'qs_content_revisions')
  const options = { ...actor, idempotencyKey: 'k-fail' }

  await assert.rejects(
    organizations.createIdempotent(TENANT_A, input, options),
    (error: unknown) => code(error) === 'AuditWriteFailed',
  )

  assert.equal(store.rawDump(TENANT_A, 'qs_organizations').length, 0, 'no record')
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, 0, 'no revision')
  assert.equal(findIdempotencyKey(store, TENANT_A, 'create', 'k-fail'), undefined, 'no key')

  const retried = await organizations.createIdempotent(TENANT_A, input, options)
  assert.equal(retried.revision, 1)
  assert.equal(store.rawDump(TENANT_A, 'qs_organizations').length, 1, 'the retry is a first attempt')
  assert.ok(findIdempotencyKey(store, TENANT_A, 'create', 'k-fail'))
})

test('an expired key is reused in place instead of accumulating a second row', async () => {
  const { store, repositories } = seededFixture()
  const organizations = organizationsOf(repositories)
  const target = await organizations.getRoot(TENANT_A)

  await organizations.updateIdempotent(TENANT_A, target.id, { name: 'Before expiry' }, { ...actor, expectedRevision: 1, idempotencyKey: 'k-expire' })
  const original = findIdempotencyKey(store, TENANT_A, 'update', 'k-expire')
  assert.ok(original)
  const originalDigest = String(original.response_digest)

  // Move the key's window into the past; the same key is then a new attempt.
  store.replace('qs_idempotency_keys', TENANT_A, String(original.id), { expires_at: '2025-01-01T00:00:00.000Z' })
  const refreshed = await organizations.updateIdempotent(TENANT_A, target.id, { name: 'After expiry' }, { ...actor, expectedRevision: 2, idempotencyKey: 'k-expire' })
  assert.equal(refreshed.revision, 3)

  const keys = store.rawDump(TENANT_A, 'qs_idempotency_keys')
  assert.equal(keys.length, 1, 'the expired row is reused, not duplicated')
  assert.equal(keys[0]?.id, original.id, 'the key keeps its row id')
  assert.notEqual(String(keys[0]?.response_digest), originalDigest, 'the row records the new response')
  assert.equal(String(keys[0]?.record_id), target.id)
})

test('C1-D06 a repeated update or publish replays, and a different request under the key conflicts', async () => {
  const { store, repositories } = seededFixture()
  const organizations = organizationsOf(repositories)
  const target = await organizations.getRoot(TENANT_A)
  const revisionsBefore = store.rawDump(TENANT_A, 'qs_content_revisions').length

  const write = { ...actor, expectedRevision: target.revision, idempotencyKey: 'k-write' }
  const first = await organizations.updateIdempotent(TENANT_A, target.id, { name: 'Idempotent update' }, write)
  assert.equal(first.revision, 2)
  const afterFirst = store.rawDump(TENANT_A, 'qs_content_revisions').length
  assert.equal(afterFirst, revisionsBefore + 1, 'the write advances the revision once')

  const replay = await organizations.updateIdempotent(TENANT_A, target.id, { name: 'Idempotent update' }, write)
  assert.equal(replay.revision, 2, 'the replay returns the original result')
  assert.equal(replay.name, 'Idempotent update')
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, afterFirst, 'the replay writes no revision')

  await assert.rejects(
    organizations.updateIdempotent(TENANT_A, target.id, { name: 'Different update' }, write),
    (error: unknown) => code(error) === 'IdempotencyConflict',
  )
  assert.equal(
    (await organizations.get(TENANT_A, target.id, { includeDraft: true })).name,
    'Idempotent update',
    'the conflicting request changes nothing',
  )

  const publish = { ...actor, expectedRevision: 2, idempotencyKey: 'k-publish' }
  const published = await organizations.publishIdempotent(TENANT_A, target.id, 2, publish)
  assert.equal(published.published_revision, 2)
  const afterPublish = store.rawDump(TENANT_A, 'qs_content_revisions').length
  const publishReplay = await organizations.publishIdempotent(TENANT_A, target.id, 2, publish)
  assert.equal(publishReplay.published_revision, 2)
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, afterPublish, 'the publish replay writes no revision')

  await assert.rejects(
    organizations.publishIdempotent(TENANT_A, target.id, 1, publish),
    (error: unknown) => code(error) === 'IdempotencyConflict',
    'a different publish request under the same key conflicts',
  )
})
