# C1 query contract report

**Status: the six §7 contracts are implemented and green on synthetic fixtures.** C0 inputs and sign-off remain blocked; this is not route wiring or a public API.

- **Command:** `npm run native:c1:test`
- **Script:** `node scripts/native-c1-test.mjs`
- **Commit under test:** `73d1cc9e38c15086b9e9a2cd6ee62b61b0115dab`
- **Artifact commit:** a later, documentation-only commit; the code under test is the commit above.
- **Adapter:** direct native repositories (no external CMS host); in-memory MemoryStore fixture adapter
- **Schema version:** `c1-catalog-89534ac4c00b`
- **Schema catalog digest:** `sha256:89534ac4c00bd19164bd40e900b6ff6aee77a07de334b033a3eea25de0ac5d14`
- **Relation inventory digest:** `sha256:6f7ecc553bfeb8ab8cf2fd74d1ec0ef7a4eba32c689661bdc9190d2884060b64`
- **Fixture manifest digest:** `sha256:44a820f99addc019c18dbd09152d8b1533c5d9c54f103d0e763f6ae734b47b70` (52 tables, row counts only)
- **Timestamp:** 2026-11-19T17:45:50.637Z
- **Counts:** 53 tests, 53 pass, 0 fail, 0 skipped, 0 todo; 50/50 matrix cases reported
- **Redaction:** commands, counts, matrix IDs and digests only; no record bodies, record IDs, tenant names or private paths.

## Contracts

| Contract | Case | Fixture | Result |
|---|---|---|---|
| `getCapabilityGraph` | `C1-G01` | capability graph fixture (inheritance, dependency, conflict, cycle/dangling refusal) | pass |
| `findContradictions` | `C1-G02` | policy conflict, evidence contradiction, metric drift; 200-finding cap | pass |
| `getWorkflowDAG` | `C1-G03` | active head, unpublished/stale/foreign null, malformed/cyclic refusal | pass |
| `getObjectiveTree` | `C1-G04` | three-level tree, orphan/cycle refusal, depth/node bounds | pass |
| `getEvidenceForMetric` | `C1-G05` | direct evidence, contradiction, tombstoned exclusion, 500-row cap | pass |
| `getDecisionHistory` | `C1-G06` | proposed→approved→executed chain, rollback, filters, cursor, paging | pass |
| `all six` | `C1-G07` | public entry points, typed results, blank-tenant refusal, no TODO, no write | pass |
| `getCapabilityGraph + findContradictions` | `C1-B10` | foreign-ID empty results with no write | pass |

## Stub check

- `quicksilver/query/index.ts` exports the six named entry points, each delegating to `quicksilver/cms/queries.ts`; no TODO or "not implemented" text remains.
- `C1-G07` executes every public entry point and requires fixture-backed data, so an unconditional empty return fails the case.
- The blank-tenant refusal is the paired control: a stub that returns an empty result cannot raise `MalformedQuery`.

## Tenant, ordering and no-write rules

- Every contract takes `tenantId` as a required argument; a missing or blank value refuses with `MalformedQuery` before any read.
- A foreign or missing ID returns the contract's empty or null result; no foreign row is returned and scope is never widened.
- Ordering, caps and truncation are asserted by `C1-G01`–`C1-G06` (nodes by id, edges by (from,to,kind), findings by (kind,id), pre-order by (name,id), evidence newest-first, events by (at,seq,eventId)).
- Read-only is structural: the contracts are typed against `QueryStore`, which exposes `rows` and `findById` only, so no write method is reachable. `C1-G07` also snapshots every catalog table for tenant A before and after the six calls and requires an unchanged digest.

## Blocked inputs

The same C0 ownership manifest, production export and asset/deletion baseline digests, entry bundle and sign-off listed in `c1-acceptance-report` remain blocked. C2 route adaptation must not start from this report alone.
