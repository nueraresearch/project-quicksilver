/**
 * Gate A — native bootstrap without a CMS (acceptance matrix §3).
 *
 * Four named cases. Each asserts its refusal or success *and* a positive
 * control, so a blanket rejection cannot make the gate green: A01 counts real
 * registrations, A02 creates and reads a real record, A03 pairs each refusal
 * with the same call under a valid tenant, and A04 proves the environment value
 * is inert rather than merely unused.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { C1_COLLECTIONS, C1_DERIVED_STORES, C1_STORES, EXCLUDED_AUTH_STORES } from '../../cms/catalog.ts'
import { MalformedQueryError, RepositoryError } from '../../cms/errors.ts'
import {
  findContradictions,
  getCapabilityGraph,
  getDecisionHistory,
  getEvidenceForMetric,
  getObjectiveTree,
  getWorkflowDAG,
} from '../../cms/queries.ts'
import { FileStore, PersistenceError } from '../../cms/filestore.ts'
import { createRepositories, type OrganizationRepository } from '../../cms/repositories.ts'
import { FORBIDDEN_ENV, TENANT_A, TENANT_B, clearForbiddenEnv, freshFixture } from './fixtures/two-tenants.ts'

const restores: Array<() => void> = []
after(() => {
  for (const restore of restores) restore()
})

function isMalformedQuery(error: unknown): boolean {
  return error instanceof RepositoryError && error.code === 'MalformedQuery'
}

async function rejectsMalformed(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(isMalformedQuery(error), `expected MalformedQuery, got ${String(error)}`)
    return true
  })
}

const ORGANIZATION = { name: 'Tenant A Holdings', slug: 'shared-root' }

test('C1-A01 registers exactly 21 native collections and 13 derived stores, with no OIDC adapter', () => {
  const { store } = freshFixture()
  const tables = store.tableNames()

  assert.equal(C1_COLLECTIONS.length, 21, 'the catalog must freeze 21 native collections')
  assert.equal(C1_DERIVED_STORES.length, 13, 'the catalog must freeze 13 derived/audit stores')

  const registeredCollections = C1_COLLECTIONS.filter((definition) => tables.includes(definition.name))
  const registeredDerived = C1_DERIVED_STORES.filter((definition) => tables.includes(definition.name))
  assert.equal(registeredCollections.length, 21, 'every native collection is registered in the store')
  assert.equal(registeredDerived.length, 13, 'every derived store is registered in the store')
  assert.equal(new Set(tables).size, tables.length, 'no table may be registered twice')

  for (const excluded of EXCLUDED_AUTH_STORES) {
    assert.ok(!tables.includes(excluded), `${excluded} is an auth adapter and must not be a CMS table`)
  }

  // Positive control: the catalog is not a list of strings the store ignored.
  assert.equal(C1_STORES.length, 34)
  assert.ok(registeredCollections.every((definition) => tables.includes(definition.name)))
})

test('C1-A02 constructs every repository and creates then reads an organization with no CMS client, network call or credential read', async () => {
  const restoreEnv = clearForbiddenEnv()
  restores.push(restoreEnv)
  const { store, repositories } = freshFixture()

  const fetchCalls: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input))
    throw new Error('the native repository path must not call the network')
  }) as typeof fetch

  try {
    // Every declared repository constructs; a missing one fails here, not later.
    assert.equal(Object.keys(repositories).length, C1_STORES.length)
    assert.equal(new Set(Object.values(repositories).map((repository) => repository.table)).size, C1_STORES.length)

    const organizations = repositories.OrganizationRepository as OrganizationRepository
    const created = await organizations.create(TENANT_A, ORGANIZATION, { actorId: 'principal-a' })
    const readBack = await organizations.get(TENANT_A, created.id)

    assert.equal(readBack.id, created.id)
    assert.equal(readBack.name, ORGANIZATION.name)
    assert.equal(readBack.revision, 1)
    assert.equal(readBack.tenant_id, TENANT_A)
    assert.equal(fetchCalls.length, 0, 'no network call may occur on the native path')
    for (const key of FORBIDDEN_ENV) {
      assert.equal(process.env[key], undefined, `${key} must stay unset on the native path`)
    }

    // The mutation's obligation landed in the same store: one revision snapshot.
    const revisions = store.rawDump(TENANT_A, 'qs_content_revisions')
    assert.equal(revisions.length, 1)
    assert.equal(revisions[0]?.record_id, created.id)
    assert.match(String(revisions[0]?.digest), /^sha256:[0-9a-f]{64}$/)

    // Positive control for the audit rule: a failed revision append aborts the
    // write. Tenant B, because tenant A already has its one root organization
    // and would refuse on that rule before reaching the audit obligation.
    store.failAuditAppend('content.create', 'qs_content_revisions')
    await assert.rejects(
      organizations.create(TENANT_B, { name: 'Should Not Exist' }, { actorId: 'principal-a' }),
      (error: unknown) => error instanceof RepositoryError && error.code === 'AuditWriteFailed',
    )
    assert.equal(store.rawDump(TENANT_B, 'qs_organizations').length, 0, 'the failed write left no organization behind')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('C1-A03 refuses a missing or blank tenant with MalformedQuery and never substitutes the environment value', async () => {
  const restoreEnv = clearForbiddenEnv()
  restores.push(restoreEnv)
  process.env.QUICKSILVER_TENANT_ID = TENANT_B

  const { store, repositories } = freshFixture()
  const organizations = repositories.OrganizationRepository as OrganizationRepository

  await rejectsMalformed(organizations.get(undefined as unknown as string, 'org_0001'))
  await rejectsMalformed(organizations.get('   ', 'org_0001'))
  await rejectsMalformed(organizations.getRoot(undefined as unknown as string))
  await rejectsMalformed(organizations.list(undefined as unknown as string, { limit: 10 }))
  await rejectsMalformed(organizations.create(undefined as unknown as string, ORGANIZATION, { actorId: 'principal-a' }))

  // Every contract refuses a missing or blank tenant before it reads a store.
  await rejectsMalformed(getCapabilityGraph(store, undefined as unknown as string))
  await rejectsMalformed(findContradictions(store, '   '))
  await rejectsMalformed(getWorkflowDAG(store, undefined as unknown as string, 'shared-graph'))
  await rejectsMalformed(getObjectiveTree(store, ''))
  await rejectsMalformed(getEvidenceForMetric(store, undefined as unknown as string, 'metric'))
  await rejectsMalformed(getDecisionHistory(store, ''))

  assert.equal(store.rawDump(TENANT_B, 'qs_organizations').length, 0, 'the environment value must not write rows')
  assert.equal(store.rawDump(TENANT_A, 'qs_organizations').length, 0)

  // Positive control: the same call with a real tenant succeeds.
  const created = await organizations.create(TENANT_A, ORGANIZATION, { actorId: 'principal-a' })
  assert.equal(created.tenant_id, TENANT_A)
})

test('C1-A04 uses only the tenant the caller passes, even when the environment names another', async () => {
  const restoreEnv = clearForbiddenEnv()
  restores.push(restoreEnv)
  process.env.QUICKSILVER_TENANT_ID = TENANT_B

  const { store, repositories } = freshFixture()
  const organizations = repositories.OrganizationRepository as OrganizationRepository

  const created = await organizations.create(TENANT_A, ORGANIZATION, { actorId: 'principal-a' })
  const readBack = await organizations.get(TENANT_A, created.id)
  assert.equal(readBack.tenant_id, TENANT_A)

  const tenantB = await organizations.list(TENANT_B, { limit: 10 })
  assert.deepEqual(tenantB.items, [], 'a write as tenant A must leave tenant B empty')
  assert.equal(store.rawDump(TENANT_B, 'qs_organizations').length, 0)
  assert.equal(store.rawDump(TENANT_A, 'qs_content_revisions').length, 1)

  // A foreign id is NotFound for the other tenant — not a body and not an existence signal.
  await assert.rejects(
    organizations.get(TENANT_B, created.id),
    (error: unknown) => error instanceof RepositoryError && error.code === 'NotFound',
  )
})

/**
 * C1 exit coverage, not a matrix case: the durable adapter must survive a
 * restart, must not reissue an id it already stored, and must refuse an
 * unreadable snapshot instead of booting empty over it.
 */
test('the durable store reloads committed rows, resumes ids and refuses a corrupt file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qs-c1-durable-boot-'))
  try {
    const path = join(dir, 'cms.json')
    const first = new FileStore(path)
    const created = await (
      createRepositories(first).OrganizationRepository as unknown as {
        create(tenantId: string, input: { name: string }, options: { actorId: string }): Promise<{ id: string }>
      }
    ).create(TENANT_A, { name: 'Durable Root' }, { actorId: 'principal-a' })

    const second = new FileStore(path)
    const reopened = createRepositories(second).OrganizationRepository as unknown as {
      getRoot(tenantId: string): Promise<{ id: string; name: string }>
      create(tenantId: string, input: { name: string }, options: { actorId: string }): Promise<{ id: string }>
    }
    const loaded = await reopened.getRoot(TENANT_A)
    assert.equal(loaded.id, created.id, 'the committed record is on disk')
    assert.equal(loaded.name, 'Durable Root', 'the body survived, not only the key')
    const next = await reopened.create(TENANT_B, { name: 'Second Root' }, { actorId: 'principal-b' })
    assert.notEqual(next.id, created.id, 'ids resume after a reload instead of restarting')

    writeFileSync(join(dir, 'broken.json'), '{"version":1,"tables":')
    assert.throws(
      () => new FileStore(join(dir, 'broken.json')),
      (error: unknown) => error instanceof PersistenceError,
      'corrupt JSON refuses to open',
    )
    writeFileSync(join(dir, 'future.json'), JSON.stringify({ version: 99, tables: {}, clock: 0, ids: {} }))
    assert.throws(
      () => new FileStore(join(dir, 'future.json')),
      (error: unknown) => error instanceof PersistenceError,
      'an unknown snapshot version refuses',
    )
    writeFileSync(join(dir, 'foreign.json'), JSON.stringify({ version: 1, tables: { qs_unknown: [] }, clock: 0, ids: {} }))
    assert.throws(
      () => new FileStore(join(dir, 'foreign.json')),
      (error: unknown) => error instanceof PersistenceError,
      'an unknown table refuses',
    )

    // Positive control: an absent path is a fresh store with the whole catalog.
    const fresh = new FileStore(join(dir, 'fresh.json'))
    assert.ok(fresh.hasTable('qs_organizations'))
    assert.equal(fresh.rows('qs_organizations').length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
