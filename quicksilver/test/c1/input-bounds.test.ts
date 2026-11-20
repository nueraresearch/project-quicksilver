/**
 * Gate F — malformed input, bounds and unresolved state (matrix §8), C1-F01–C1-F06.
 *
 * Malformed input is refused before any read widens scope; each refusal is
 * paired with a positive control at the boundary or with valid input.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RepositoryError } from '../../cms/errors.ts'
import { getDecisionHistory } from '../../cms/queries.ts'
import type { BaseRepository, ContentRecord, DepartmentRepository, OrganizationRepository } from '../../cms/repositories.ts'
import { TENANT_A, TENANT_B, seededFixture } from './fixtures/two-tenants.ts'

const actor = { actorId: 'principal-a' }

function code(error: unknown): string | undefined {
  return error instanceof RepositoryError ? error.code : undefined
}

test('C1-F01 list rejects limit 0, 101 and a non-integer, and accepts the maximum', async () => {
  const { repositories } = seededFixture()
  const contacts = repositories.ContactRepository as unknown as BaseRepository<ContentRecord>

  for (const limit of [0, 101, 2.5]) {
    await assert.rejects(
      contacts.list(TENANT_A, { limit }),
      (error: unknown) => code(error) === 'MalformedQuery',
      `limit ${limit} must be refused`,
    )
  }

  const boundary = await contacts.list(TENANT_A, { limit: 100 })
  assert.equal(boundary.items.length, 3, 'the maximum limit returns the tenant’s page, not an unbounded read')
  assert.ok(boundary.items.every((row) => row.tenant_id === TENANT_A))
})

test('C1-F02 a malformed cursor and a foreign cursor are refused, and A’s cursor pages A', async () => {
  const { repositories } = seededFixture()
  const contacts = repositories.ContactRepository as unknown as BaseRepository<ContentRecord>

  await assert.rejects(
    contacts.list(TENANT_A, { limit: 1, cursor: 'not-a-cursor' }),
    (error: unknown) => code(error) === 'MalformedQuery',
    'garbage is not a cursor',
  )

  const firstPage = await contacts.list(TENANT_A, { limit: 1 })
  assert.ok(firstPage.nextCursor)
  await assert.rejects(
    contacts.list(TENANT_B, { limit: 1, cursor: firstPage.nextCursor! }),
    (error: unknown) => code(error) === 'MalformedQuery',
    'a cursor is tenant-bound',
  )

  const nextPage = await contacts.list(TENANT_A, { limit: 1, cursor: firstPage.nextCursor! })
  assert.equal(nextPage.items.length, 1)
  assert.notEqual(nextPage.items[0]?.id, firstPage.items[0]?.id, 'the positive control returns the next row')
})

test('C1-F03 invalid filters are refused and a cross-tenant filter never widens the result', async () => {
  const { seeds } = seededFixture()

  await assert.rejects(
    getDecisionHistory(seededFixture().store, TENANT_A, { status: ['not-a-status'] }),
    (error: unknown) => code(error) === 'MalformedQuery',
    'unknown status',
  )
  await assert.rejects(
    getDecisionHistory(seededFixture().store, TENANT_A, { from: 'yesterday' }),
    (error: unknown) => code(error) === 'MalformedQuery',
    'invalid date',
  )
  await assert.rejects(
    getDecisionHistory(seededFixture().store, TENANT_A, { kind: 'other' as never }),
    (error: unknown) => code(error) === 'MalformedQuery',
    'invalid kind',
  )

  // B's decision id is a valid filter value, and A has no such decision: the
  // result is empty rather than another tenant's events.
  const foreign = await getDecisionHistory(seededFixture().store, TENANT_A, { decisionId: seeds[TENANT_B].decision })
  assert.deepEqual(foreign.events, [], 'no foreign rows')
  assert.equal(foreign.nextCursor, null)

  const positive = await getDecisionHistory(seededFixture().store, TENANT_A, {
    decisionId: seeds[TENANT_A].decision,
    status: ['proposed'],
  })
  assert.equal(positive.events.length, 1, 'the positive control returns A’s one event')
  assert.equal(positive.events[0]?.decisionId, seeds[TENANT_A].decision)
})

test('C1-F04 paging the decision history neither duplicates nor skips an event', async () => {
  const { store, seeds } = seededFixture()
  const decisionId = seeds[TENANT_A].decision
  for (let seq = 2; seq <= 6; seq += 1) {
    store.insert('qs_decision_events', {
      tenant_id: TENANT_A,
      id: `paged-evt-${seq}`,
      decision_id: decisionId,
      seq,
      event_id: `paged-ev-${seq}`,
      event_type: 'transition',
      from_status: 'proposed',
      to_status: seq % 2 === 0 ? 'approved' : 'executed',
      actor_id: 'principal-a',
      at: `2026-01-01T00:00:0${seq}.000Z`,
      payload_digest: `digest-${seq}`,
      prev_hash: `hash-${seq - 1}`,
      hash: `hash-${seq}`,
    })
  }

  const seen: string[] = []
  let cursor: string | undefined
  for (let page = 0; page < 10; page += 1) {
    const result = await getDecisionHistory(store, TENANT_A, { decisionId, limit: 2, cursor })
    seen.push(...result.events.map((event) => event.eventId))
    if (!result.nextCursor) break
    cursor = result.nextCursor
  }

  assert.equal(seen.length, 6, 'every event is returned')
  assert.equal(new Set(seen).size, 6, 'no event is duplicated')
  const order = await getDecisionHistory(store, TENANT_A, { decisionId, limit: 10 })
  const all = await getDecisionHistory(store, TENANT_A, { decisionId, limit: 50 })
  assert.deepEqual(order.events.map((event) => event.eventId), all.events.map((event) => event.eventId))
  assert.deepEqual(
    order.events.map((event) => event.seq),
    [6, 5, 4, 3, 2, 1],
    'ordering is (at, seq, eventId), newest first and stable',
  )
})

test('C1-F05 an unresolved relation target is refused and writes nothing', async () => {
  const { store, seeds, repositories } = seededFixture()
  const departments = repositories.DepartmentRepository as unknown as DepartmentRepository
  const joinsBefore = store.rawDump(TENANT_A, 'qs_department_members').length

  await assert.rejects(
    departments.addMember(TENANT_A, seeds[TENANT_A].department, 'ent_missing', actor),
    (error: unknown) => code(error) === 'UnresolvedRelation',
  )
  assert.equal(store.rawDump(TENANT_A, 'qs_department_members').length, joinsBefore, 'no join row')

  await departments.addMember(TENANT_A, seeds[TENANT_A].department, seeds[TENANT_A].entity, actor)
  assert.equal(store.rawDump(TENANT_A, 'qs_department_members').length, joinsBefore + 1, 'the positive control links')
})

test('C1-F06 an update cannot change tenant_id', async () => {
  const { store, repositories } = seededFixture()
  const organizations = repositories.OrganizationRepository as unknown as OrganizationRepository
  const target = await organizations.getRoot(TENANT_A)
  const revisionsBefore = store.rawDump(TENANT_A, 'qs_content_revisions').length

  await assert.rejects(
    organizations.update(TENANT_A, target.id, { tenant_id: TENANT_B, name: 'Moved' }, { ...actor, expectedRevision: 1 }),
    (error: unknown) => code(error) === 'MalformedQuery',
  )

  const after = await organizations.get(TENANT_A, target.id, { includeDraft: true })
  assert.equal(after.tenant_id, TENANT_A, 'the tenant is unchanged')
  assert.equal(after.revision, 1)
  assert.equal(after.name, target.name)
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, revisionsBefore, 'no revision was written')

  const updated = await organizations.update(TENANT_A, target.id, { name: 'Renamed' }, { ...actor, expectedRevision: 1 })
  assert.equal(updated.name, 'Renamed', 'the positive control succeeds')
})
