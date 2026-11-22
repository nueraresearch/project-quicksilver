/**
 * C2 — the first durable adapter.
 *
 * C1's suite runs on an in-memory fixture, so it can prove repository behaviour
 * but not that anything survives a process. These cases run the same
 * repositories over `FileStore` and assert the properties a cutover depends on:
 * reopen, id continuity, fail-closed loading, and a failed write that leaves
 * neither disk nor memory ahead of the other.
 *
 * Every refusal is paired with the same call under valid input, so a store that
 * simply refused everything could not pass.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { FileStore, SNAPSHOT_FILE, StorePersistenceError } from '../../cms/file-store.ts'
import { OrganizationRepository } from '../../cms/repositories.ts'

const roots: string[] = []

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qs-c2-store-'))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

type CreateInput = Parameters<OrganizationRepository['create']>[1]
type Write = Parameters<OrganizationRepository['create']>[2]

const ORGANIZATION: CreateInput = { name: 'Tenant A Holdings', slug: 'shared-root' }
const WRITE: Write = { actorId: 'principal-founder' }

function open(dir: string): { store: FileStore; organizations: OrganizationRepository } {
  const store = new FileStore({ root: dir })
  return { store, organizations: new OrganizationRepository(store) }
}

test('C2-P01 a record written by one store is readable by the next over the same directory', async () => {
  const dir = tempRoot()
  const first = open(dir)
  const created = await first.organizations.create('tenant-a', ORGANIZATION, WRITE)

  const second = open(dir)
  const reloaded = await second.organizations.getRoot('tenant-a')
  assert.equal(reloaded.id, created.id)
  assert.equal(reloaded.name, ORGANIZATION.name)
  assert.equal(reloaded.revision, 1)

  // Positive control: the reopen read the right tenant, not the only tenant.
  await assert.rejects(second.organizations.getRoot('tenant-b'), /no root organization/)
})

test('C2-P02 id counters continue across a reopen instead of restarting', async () => {
  const dir = tempRoot()
  const first = open(dir)
  const tenantA = await first.organizations.create('tenant-a', ORGANIZATION, WRITE)
  assert.equal(tenantA.id, 'org_0001')

  const second = open(dir)
  const tenantB = await second.organizations.create('tenant-b', ORGANIZATION, WRITE)
  assert.equal(tenantB.id, 'org_0002', 'a reopen must not reissue org_0001')

  const third = open(dir)
  assert.equal((await third.organizations.getRoot('tenant-b')).id, 'org_0002')
})

test('C2-P03 the snapshot is versioned and carries every registered table', async () => {
  const dir = tempRoot()
  const { store, organizations } = open(dir)
  await organizations.create('tenant-a', ORGANIZATION, WRITE)

  const snapshot = JSON.parse(readFileSync(join(dir, SNAPSHOT_FILE), 'utf8'))
  assert.equal(snapshot.formatVersion, 1)
  assert.deepEqual(Object.keys(snapshot.tables).sort(), [...store.tableNames()].sort())
  assert.equal(snapshot.tables.qs_organizations.length, 1)
})

test('C2-P04 a truncated snapshot refuses to open rather than reading as an empty store', async () => {
  const dir = tempRoot()
  const { store, organizations } = open(dir)
  await organizations.create('tenant-a', ORGANIZATION, WRITE)
  const valid = readFileSync(join(dir, SNAPSHOT_FILE), 'utf8')

  writeFileSync(join(dir, SNAPSHOT_FILE), valid.slice(0, Math.floor(valid.length / 2)))
  assert.throws(() => new FileStore({ root: dir }), StorePersistenceError)

  // Positive control: the same directory opens again once the snapshot is whole.
  writeFileSync(join(dir, SNAPSHOT_FILE), valid)
  const reopened = new FileStore({ root: dir })
  assert.equal(reopened.rawDump('tenant-a', 'qs_organizations').length, 1)
  assert.equal(store.rawDump('tenant-a', 'qs_organizations').length, 1)
})

test('C2-P05 a snapshot naming an unknown table refuses to open', async () => {
  const dir = tempRoot()
  const { organizations } = open(dir)
  await organizations.create('tenant-a', ORGANIZATION, WRITE)

  const snapshot = JSON.parse(readFileSync(join(dir, SNAPSHOT_FILE), 'utf8'))
  snapshot.tables.qs_not_a_catalog_table = [{ id: 'ghost', tenant_id: 'tenant-a' }]
  writeFileSync(join(dir, SNAPSHOT_FILE), JSON.stringify(snapshot))

  assert.throws(
    () => new FileStore({ root: dir }),
    (error: unknown) => error instanceof StorePersistenceError && /unknown table: qs_not_a_catalog_table/.test(error.message),
  )
})

test('C2-P06 a failed save leaves disk and memory at the previous state', async () => {
  const dir = tempRoot()
  const first = open(dir)
  const tenantA = await first.organizations.create('tenant-a', ORGANIZATION, WRITE)

  first.store.failNextSave()
  await assert.rejects(
    first.organizations.create('tenant-b', ORGANIZATION, WRITE),
    (error: unknown) => error instanceof StorePersistenceError && /injected save failure/.test(error.message),
  )

  assert.deepEqual(first.store.rawDump('tenant-b', 'qs_organizations'), [], 'memory must not keep the failed write')
  assert.equal(first.store.rawDump('tenant-a', 'qs_organizations').length, 1)

  const reopened = open(dir)
  assert.deepEqual(reopened.store.rawDump('tenant-b', 'qs_organizations'), [], 'disk must not keep the failed write')
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_organizations')[0].id, tenantA.id)

  // Positive control: the same create succeeds once the save is not failed.
  // The rolled-back write consumed no id, so the retry takes the next number;
  // what matters is that a persisted id is never reissued, and that the id the
  // caller receives is the one on disk.
  const tenantB = await first.organizations.create('tenant-b', ORGANIZATION, WRITE)
  assert.notEqual(tenantB.id, tenantA.id)
  assert.equal(tenantB.id, 'org_0002', 'a rolled-back write consumes no id')
  const persisted = open(dir).store.rawDump('tenant-b', 'qs_organizations')
  assert.equal(persisted.length, 1)
  assert.equal(persisted[0].id, tenantB.id)
})

test('C2-P07 tenant isolation holds through the durable adapter', async () => {
  const dir = tempRoot()
  const { store, organizations } = open(dir)
  const tenantA = await organizations.create('tenant-a', ORGANIZATION, WRITE)
  const tenantB = await organizations.create('tenant-b', ORGANIZATION, WRITE)

  assert.equal(store.findById('qs_organizations', 'tenant-b', tenantA.id), undefined)
  assert.equal(store.existsInAnotherTenant('qs_organizations', 'tenant-b', tenantA.id), true)
  // Positive control: the same lookup succeeds inside the owning tenant.
  assert.equal(store.findById('qs_organizations', 'tenant-a', tenantA.id)?.id, tenantA.id)
  assert.equal(store.findById('qs_organizations', 'tenant-b', tenantB.id)?.id, tenantB.id)
})

test('C2-P08 an update that touches the record and its revision is one snapshot write', async () => {
  const dir = tempRoot()
  const { store, organizations } = open(dir)
  const created = await organizations.create('tenant-a', ORGANIZATION, WRITE)
  const before = store.snapshotWrites()

  const updated = await organizations.update(
    'tenant-a',
    created.id,
    { mission: 'Keep the handover honest' },
    { expectedRevision: 1, actorId: 'principal-founder' },
  )

  assert.equal(updated.revision, 2)
  assert.equal(store.snapshotWrites() - before, 1, 'a two-table update must commit once, not once per table')
  assert.equal(store.rawDump('tenant-a', 'qs_organizations')[0].revision, 2)
  assert.equal(store.rawDump('tenant-a', 'qs_content_revisions').length, 2)

  // Positive control: the single commit is a real one, readable by the next process.
  const reopened = open(dir)
  assert.equal((await reopened.organizations.getRoot('tenant-a')).revision, 2)
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_content_revisions').length, 2)
})

test('C2-P09 a failed commit leaves neither the bumped record nor its revision row', async () => {
  const dir = tempRoot()
  const { store, organizations } = open(dir)
  const created = await organizations.create('tenant-a', ORGANIZATION, WRITE)
  const before = store.snapshotWrites()

  // The record and the revision are written together, so failing that one write
  // is failing "between" them: neither may survive.
  store.failNextSave()
  await assert.rejects(
    organizations.update(
      'tenant-a',
      created.id,
      { mission: 'never lands' },
      { expectedRevision: 1, actorId: 'principal-founder' },
    ),
    (error: unknown) => error instanceof StorePersistenceError && /injected save failure/.test(error.message),
  )

  assert.equal(store.snapshotWrites(), before, 'a failed commit writes no snapshot')
  const inMemory = store.rawDump('tenant-a', 'qs_organizations')[0]
  assert.equal(inMemory.revision, 1, 'the recorded revision must not advance')
  assert.equal(inMemory.mission, undefined, 'the patch must not survive the failed commit')
  assert.equal(store.rawDump('tenant-a', 'qs_content_revisions').length, 1, 'the revision row must not survive either')

  const reopened = open(dir)
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_organizations')[0].revision, 1)
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_organizations')[0].mission, undefined)
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_content_revisions').length, 1)

  // Positive control: the same update commits both halves when the write is not failed.
  const updated = await organizations.update(
    'tenant-a',
    created.id,
    { mission: 'lands' },
    { expectedRevision: 1, actorId: 'principal-founder' },
  )
  assert.equal(updated.revision, 2)
  const committed = open(dir)
  assert.equal(committed.store.rawDump('tenant-a', 'qs_organizations')[0].mission, 'lands')
  assert.deepEqual(
    committed.store
      .rawDump('tenant-a', 'qs_content_revisions')
      .map((row) => Number(row.revision))
      .sort((left, right) => left - right),
    [1, 2],
    'both revisions are on disk, and the failed attempt left no third row',
  )
})

test('C2-P10 a failure after the record write and before its revision row leaves the record unchanged', async () => {
  const dir = tempRoot()
  const { store, organizations } = open(dir)
  const created = await organizations.create('tenant-a', ORGANIZATION, WRITE)
  const writes = store.snapshotWrites()

  // The record has already been replaced when the revision row is allocated, so
  // throwing here is the failure the two writes used to allow: a bumped record
  // with no revision to read it back from. One commit means the rollback has to
  // undo the record write too.
  const nextId = store.ids.next.bind(store.ids)
  store.ids.next = () => {
    throw new Error('injected revision failure')
  }
  await assert.rejects(
    organizations.update(
      'tenant-a',
      created.id,
      { mission: 'never lands' },
      { expectedRevision: 1, actorId: 'principal-founder' },
    ),
    /injected revision failure/,
  )
  store.ids.next = nextId

  assert.equal(store.snapshotWrites(), writes, 'a rolled-back write commits nothing')
  const inMemory = store.rawDump('tenant-a', 'qs_organizations')[0]
  assert.equal(inMemory.revision, 1, 'the record write must be undone')
  assert.equal(inMemory.mission, undefined)
  assert.equal(store.rawDump('tenant-a', 'qs_content_revisions').length, 1)

  const reopened = open(dir)
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_organizations')[0].revision, 1)
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_organizations')[0].mission, undefined)
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_content_revisions').length, 1)

  // Positive control: with ids working again the same update commits both halves,
  // and the rolled-back attempt left no third row behind.
  const updated = await organizations.update(
    'tenant-a',
    created.id,
    { mission: 'lands' },
    { expectedRevision: 1, actorId: 'principal-founder' },
  )
  assert.equal(updated.revision, 2)
  assert.deepEqual(
    store.rawDump('tenant-a', 'qs_content_revisions').map((row) => Number(row.revision)),
    [1, 2],
    'one revision row per committed write',
  )
})

test('C2-P12 an idempotent create commits its record, revision and key together', async () => {
  const dir = tempRoot()
  const { store, organizations } = open(dir)
  const before = store.snapshotWrites()

  const created = await organizations.createIdempotent('tenant-a', ORGANIZATION, {
    ...WRITE,
    idempotencyKey: 'k-one',
  })

  assert.equal(store.snapshotWrites() - before, 1, 'record, revision and key are one commit')
  assert.equal(store.rawDump('tenant-a', 'qs_organizations').length, 1)
  assert.equal(store.rawDump('tenant-a', 'qs_content_revisions').length, 1)
  assert.equal(store.rawDump('tenant-a', 'qs_idempotency_keys').length, 1)

  // Positive control: the same key replays the first result instead of writing.
  const replay = await organizations.createIdempotent('tenant-a', ORGANIZATION, {
    ...WRITE,
    idempotencyKey: 'k-one',
  })
  assert.equal(replay.id, created.id)
  assert.equal(store.snapshotWrites() - before, 1, 'a replay commits nothing')
  assert.equal(open(dir).store.rawDump('tenant-a', 'qs_idempotency_keys').length, 1)
})

test('C2-P13 a failure before the key row leaves no record, revision or key', async () => {
  const dir = tempRoot()
  const { store, organizations } = open(dir)
  const owning = store.ids.next.bind(store.ids)
  // The record and revision have been written by the time the key's id is
  // allocated, so throwing here is the failure that used to leave a record
  // without the key that makes its retry a replay.
  store.ids.next = (prefix: string) => {
    if (prefix === 'idem') throw new Error('injected key failure')
    return owning(prefix)
  }

  await assert.rejects(
    organizations.createIdempotent('tenant-a', ORGANIZATION, { ...WRITE, idempotencyKey: 'k-doomed' }),
    /injected key failure/,
  )
  store.ids.next = owning

  assert.equal(store.rawDump('tenant-a', 'qs_organizations').length, 0, 'no record')
  assert.equal(store.rawDump('tenant-a', 'qs_content_revisions').length, 0, 'no revision')
  assert.equal(store.rawDump('tenant-a', 'qs_idempotency_keys').length, 0, 'no key')

  const reopened = open(dir)
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_organizations').length, 0, 'nothing reached disk either')
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_content_revisions').length, 0)
  assert.equal(reopened.store.rawDump('tenant-a', 'qs_idempotency_keys').length, 0)

  // Positive control: the retry is a first attempt, and the rolled-back write
  // consumed no id.
  const created = await organizations.createIdempotent('tenant-a', ORGANIZATION, {
    ...WRITE,
    idempotencyKey: 'k-doomed',
  })
  assert.equal(created.id, 'org_0001', 'a rolled-back write consumes no id')
  assert.equal(store.rawDump('tenant-a', 'qs_organizations').length, 1)
  assert.equal(store.rawDump('tenant-a', 'qs_content_revisions').length, 1)
  assert.equal(store.rawDump('tenant-a', 'qs_idempotency_keys').length, 1)
})

