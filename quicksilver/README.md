# Quicksilver CMS Module

This directory holds the Quicksilver-owned content module. The C1 native CMS —
store catalog, tenant-scoped repositories and the six query contracts — lives
under `cms/`, `query/` and `test/c1/`. The Strapi plugin here is an
optional-adapter example, not the chassis: the recorded decision (2026-11-19) is
direct native repositories with no CMS host. Strapi is not the product's source
of authority.

## Layout

- `cms/`: the native store catalog, tenant-scoped repositories, relations,
  tenancy, idempotency, and the six query implementations.
- `ontology/`: ten collection-type schemas, each carrying `tenantId`; the
  starting point for the native catalog, shared with the Strapi example.
- `query/`: the six tenant-scoped query contracts; each delegates to `cms/queries.ts`.
- `engine/`: contradiction-analysis and decision-lifecycle placeholders. The C1
  contradiction contract is implemented in `cms/queries.ts`; these methods are not.
- `context/`: deterministic tenant context placeholder.
- `test/c1/`: the 50-case C1 acceptance suite behind `npm run native:c1:test`.
- `utils/`: shared tenant-scoped types.
- `server/src/`: Strapi plugin entrypoint and content-type registry.
- `strapi.plugins.example.ts`: host configuration fragment to enable this plugin.

## Registration and Current Host

The plugin exports schemas through Strapi's `contentTypes` plugin property;
their UIDs are `plugin::quicksilver.<singularName>`. Merge the `quicksilver`
entry from `strapi.plugins.example.ts` into a Strapi host's `config/plugins.ts`,
adjusting the `resolve` path relative to that host.

Project Quicksilver currently has a Sanity web/Studio host and does not include
a Strapi host or Strapi dependency. The plugin is therefore **not active or
runtime-registered**, and under the recorded chassis decision it stays an
optional-adapter example rather than a migration step; the native catalog and
repositories do not require a CMS host.

The eventual product should start with the Quicksilver-owned backend without a
Sanity project, Sanity credentials, external Strapi project, or external CMS
service. Sanity and standalone Strapi connectivity may remain optional adapters
for migration or deployments that choose them. See
[`docs/platform/native-local.md`](../docs/platform/native-local.md) for the
feature-parity gate and cutover rules.

## Tenant Isolation

Every content type includes a required, non-configurable string `tenantId`.
Relations are only valid between records with the same tenant. Strapi's normal
relation schema does not provide composite tenant foreign keys, so the C1
repository layer enforces the rule: `cms/relations.ts` and the repositories
refuse a foreign or cross-tenant ID, and every query contract requires an
explicit tenant argument. Deriving tenant identity from an authenticated
principal on a request is C2, not C1. The field alone is not an isolation
boundary.

The six query contracts and the C1 store/repository layer are implemented and
green against the in-memory fixture store: `npm run native:c1:test` runs the
50-case matrix with zero skipped or todo, and the guard-removal provocation
catches all six mutations. `engine/contradictionEngine.ts`,
`engine/decisionLifecycle.ts` and `context/contextBuilder.ts` still throw TODO
errors, no web route reads the native stores, and C1 has not exited — the C0
export, signed ownership manifest and C1 entry bundle are outstanding. Approval
authority remains with the NQC Kernel.

## Persistence adapters

`MemoryStore` is the C1 fixture and stays the default for the acceptance suite.
`FileStore` (C2) is the first durable adapter: a versioned `snapshot.json`
rewritten atomically per mutation, memory rolled back when a write fails, id
counters seeded from disk so a reopen cannot reissue an id, and fail-closed
loading (truncated, malformed or unknown-table snapshots refuse rather than
reading as empty).

It is single-process and no route uses it yet, so no capability row changes
status. Repositories are typed against `Store`, so a server-backed adapter can
replace it without touching repository code.

```
npm run native:c2:test   # reopen, id continuity, corruption, failed write, isolation
```
