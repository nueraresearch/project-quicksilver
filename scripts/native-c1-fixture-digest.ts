/**
 * Redaction-safe digests for the C1 acceptance evidence (matrix §2.2, §2.5).
 *
 * Prints table names and row counts only — never a record body, an id or a
 * tenant name — so the committed evidence can carry a fixture manifest digest
 * without carrying fixture data.
 *
 * Run with: node --experimental-strip-types scripts/native-c1-fixture-digest.ts
 */
import { C1_STORES } from '../quicksilver/cms/catalog.ts'
import { RELATION_INVENTORY } from '../quicksilver/cms/relations.ts'
import { digestOf } from '../quicksilver/cms/store.ts'
import { seededFixture } from '../quicksilver/test/c1/fixtures/two-tenants.ts'

const { store } = seededFixture()

const joinTables = RELATION_INVENTORY.flatMap((relation) => (relation.joinTable ? [relation.joinTable] : []))
const tables = [...new Set([...C1_STORES.map(({ name }) => name), ...joinTables])].sort()
const manifest = tables.map((table) => [table, store.rows(table).length])

const catalog = C1_STORES.map(({ name, kind, key, repository }) => ({
  name,
  kind,
  key: [...key],
  repository,
})).sort((left, right) => left.name.localeCompare(right.name))

console.log(
  JSON.stringify({
    fixtureDigest: digestOf(manifest),
    fixtureTables: tables.length,
    schemaVersion: `c1-catalog-${digestOf(catalog).slice('sha256:'.length, 'sha256:'.length + 12)}`,
    schemaCatalogDigest: digestOf(catalog),
    relationInventoryDigest: digestOf(RELATION_INVENTORY.map(({ id }) => id).sort()),
  }),
)
