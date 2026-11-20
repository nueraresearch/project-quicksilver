# C1 acceptance test matrix (draft)

- **Status:** Design-only acceptance specification. It adds no test code, schema, migration, repository, route, or runtime behavior.
- **Date:** 2026-11-17
- **Scope:** The C1 exit gate in [native CMS cutover](native-cms-cutover.md#c1--native-content-model-and-tenant-scoped-repositories), using the [C1 schema and repository map](native-cms-c1-schema-repository-map.md), the [field mapping and tenant registry](native-cms-field-mapping-tenant-registry.md), and the [C0 inventory](native-cms-c0-inventory.md).
- **Gate rule:** C1 is not complete until every case below exists, runs against the chosen persistence adapter, and passes with **zero skipped, zero todo, and zero failing** cases. A missing case is a failed gate, not an untested edge.
- **Implementation sequence:** [C1 implementation sequence](native-cms-c1-implementation-sequence.md) orders the work and names the evidence and stop points; this matrix remains the gate.
- **Not authorized:** This document does not authorize importing production data, changing Sanity or Strapi status, wiring routes, or generating code.

## 1. What makes a case pass

Each row is one named test. A test passes only when all four checks hold:

1. The exact repository error in the table is returned, or the stated success result is returned.
2. The operation leaves the specified records, revisions, joins, audit rows, and idempotency rows in the stated state.
3. No foreign-tenant identifier, display name, record body, or existence signal is exposed beyond what the contract permits.
4. The case fails when its guard is removed. A positive control in the same suite proves the operation otherwise succeeds, so a blanket rejection cannot pass the matrix.

Repository errors are the C1 contract: `NotFound`, `CrossTenantRelation`, `RevisionConflict`, `IdempotencyConflict`, `UnresolvedRelation`, `MalformedQuery`, `AppendOnlyViolation`, and `AuditWriteFailed`. HTTP status mapping belongs to C2 and is not tested here.

## 2. Executable harness contract

### 2.1 Runner and planned files

The implementation adds one command. It is wired as `npm run native:c1:test` and refuses closed while the files below are absent, so C1 cannot exit yet.

```bash
npm run native:c1:test
```

That script runs the C1 files with Node's test runner and fails if a matrix ID is absent from the report or marked skipped/todo:

```bash
node --experimental-strip-types --no-warnings --test --test-concurrency=1 \
  quicksilver/test/c1/bootstrap.test.ts \
  quicksilver/test/c1/tenancy.test.ts \
  quicksilver/test/c1/revisions.test.ts \
  quicksilver/test/c1/idempotency.test.ts \
  quicksilver/test/c1/audit-atomicity.test.ts \
  quicksilver/test/c1/input-bounds.test.ts \
  quicksilver/test/c1/queries.test.ts
```

The planned fixture module is `quicksilver/test/c1/fixtures/two-tenants.ts`. These paths are proposals for the implementation; no such files are created by this document.

### 2.2 Fixtures

Every suite starts from the same synthetic fixture module and a fresh, isolated store.

- **Tenants:** `tenant-a` and `tenant-b`. No production tenant names, IDs, contacts, or payloads.
- **Collision:** both tenants receive the same business keys (`shared-root` slug, `shared-graph` graph id, `shared-agent` agent id, `shared-lineage` policy lineage). Primary record IDs remain distinct unless the selected adapter explicitly supports tenant-local IDs.
- **Graph:** each tenant gets a root organization, department, entity, capability, policy, objective, workflow, automation workflow and publication head, decision, evidence, metric, contact, commitment, scheduled item, and drafted communication. Append-only fixtures cover a decision event, metric observation, money entry, intent-ledger entry, review, and each publication/authorization audit.
- **Determinism:** fixed clock `2026-01-01T00:00:00.000Z`, deterministic IDs, stable ordering, and no random values in assertions.
- **No credentials:** the fixture module does not read `.env`, Sanity, Strapi, model, or vault configuration.
- **Relation coverage:** a fixture manifest enumerates every row in the C1 §6 relation inventory. A relation with no fixture fails the suite.

### 2.3 Test seams

Only the following seams may be substituted. The repository boundary itself is real.

| Seam | Use |
|---|---|
| `failAuditAppend(operation, tenantId)` | Fail the next required audit/revision/event append while allowing the primary write to reach the transaction. |
| `barrier` | Hold two operations after they read the same revision or head CAS value, then release both. |
| `rawDump(tenantId, table)` | Read-only test inspection for rows, revisions, joins, and audit counts. |
| Fixed clock and deterministic ID source | Reproducible timestamps and ordering. |

### 2.4 Audit obligation per mutation

“Audit” means the row that makes the mutation inspectable. A failed append must abort the primary write.

| Mutation | Required audit/evidence row |
|---|---|
| Content create, update, publish, archive, soft delete, restore | `qs_content_revisions` snapshot and state |
| Decision transition | `qs_decision_events` |
| Metric observation | `qs_metric_observations` |
| Automation workflow publication head move | `qs_workflow_publication_audits` |
| Agent publication head move | `qs_agent_publication_audits` |
| Department execution | `qs_department_execution_audits` |
| Authorization decision | `qs_authorization_decision_audits` |
| Money or intent-ledger append | The hash-linked entry itself |

### 2.5 Evidence artifact

The runner records the command, commit, adapter, schema version, timestamp, matrix IDs, pass/fail counts, and the fixture manifest digest. The committed evidence copy contains no record bodies or tenant identifiers.

## 3. Gate A — native bootstrap without a CMS

| ID | Setup | Action | Expected result |
|---|---|---|---|
| **C1-A01** | Fresh store; no CMS configured. | Register the C1 schema and enumerate stores. | Exactly 21 native collections and 13 derived/audit stores are present. The two OIDC adapters are absent. |
| **C1-A02** | All `SANITY_*`, `NEXT_PUBLIC_SANITY_*`, and external-Strapi variables unset. | Construct every repository, create one organization, read it back. | The create/read succeeds with no CMS client construction, network call, or credential read. |
| **C1-A03** | `QUICKSILVER_TENANT_ID=tenant-b`. | Call a repository and all six query functions with a missing or blank tenant. | `MalformedQuery`; no row is read or written; the environment value never substitutes for the argument. |
| **C1-A04** | `QUICKSILVER_TENANT_ID=tenant-b`; caller passes `tenant-a`. | Read and write a tenant-a record. | The operation uses tenant A only. Tenant B is unchanged and no default-tenant fallback occurs. |

## 4. Gate B — two-tenant fixtures and cross-tenant refusals

| ID | Setup | Action | Expected result |
|---|---|---|---|
| **C1-B01** | `F2` fixture with identical business keys in A and B. | Read each tenant's root, graph, agent, and policy lineage. | Each tenant resolves its own record; business-key collisions do not merge rows, relations, heads, or audit chains. |
| **C1-B02** | A and B both have a record; caller is tenant A. | Read B's record by ID. | `NotFound`; no B body, tenant name, or other-tenant existence detail. A's record remains unchanged. |
| **C1-B03** | `F2` fixture. | List every repository exposed by C1 for tenant A, then tenant B. | Each page contains only its tenant's rows; counts match the fixture; no row appears in both unless explicitly shared by registry policy. |
| **C1-B04** | Completed page for A with a next cursor. | Use A's cursor with tenant B; then reuse it with A. | B gets `MalformedQuery` and no rows. A's retry returns the same next page with no duplicate or skipped row. |
| **C1-B05** | A objective and B entity exist. | Set A's objective owner to B's entity. | `CrossTenantRelation`; A's revision and audit count do not change; B is unchanged. |
| **C1-B06** | A department and B entity exist. | Add B's entity to A's department members; repeat for a capability and an authorized entity. | `CrossTenantRelation`; no join row is inserted; both endpoint revisions and audit counts are unchanged. |
| **C1-B07** | A decision and B entity/capability/policy exist. | Write each typed decision-context target using B's record; then write one valid A target. | Foreign writes return `CrossTenantRelation` and produce no decision event. The valid A target succeeds with exactly one target type. |
| **C1-B08** | A and B each have a workflow graph, automation version, and publication head; same for agents. | Point A's head at B's version; repeat for the agent head. | `CrossTenantRelation`; `casRevision`, `activeVersion`, and audit counts are unchanged on both heads. |
| **C1-B09** | A commitments, scheduled items, and drafts; B contacts, decisions, and commitments. | Link each A operator record to a B target in turn. | `CrossTenantRelation` for every link; no A row, join, revision, or audit changes. |
| **C1-B10** | A and B have complete query fixtures; caller is A. | Call `getCapabilityGraph(A)` and `findContradictions(A)`; call the four ID-taking contracts with B's graph, objective, metric, and decision IDs. | Each contract returns the empty/null result its contract specifies; no B row or derived finding is returned; no query writes. |
| **C1-B11** | Fixture manifest and C1 §6 relation inventory. | Run the parameterized relation suite. | Every relation has at least one same-tenant success case and one cross-tenant refusal case. A missing relation fixture fails the suite. |

## 5. Gate C — revisions and optimistic concurrency

| ID | Setup | Action | Expected result |
|---|---|---|---|
| **C1-C01** | Record at revision 1. | Update with `expectedRevision: 0`. | `RevisionConflict`; current row, revision, snapshot, and audit count remain at revision 1. |
| **C1-C02** | Record at revision 1; two writers read it. | Release both updates with `expectedRevision: 1` through the barrier. | Exactly one succeeds and one returns `RevisionConflict`; final revision is 2; exactly one new revision/audit row; the stored snapshot matches the winner. |
| **C1-C03** | Draft at revision 2, published revision 1. | Publish with `expectedRevision: 1`. | `RevisionConflict`; `published_revision` stays 1; no publish audit is appended. |
| **C1-C04** | Record at revision 2. | Call archive, soft delete, and restore with a stale revision, one operation per test. | Each returns `RevisionConflict`; lifecycle, tombstone fields, `published_revision`, and audit count stay unchanged. |
| **C1-C05** | Record at revision 1. | Update without `expectedRevision`. | `MalformedQuery`; no write, revision, or audit. The positive control with revision 1 succeeds. |
| **C1-C06** | Record at revision 1; published revision 1. | Update to revision 2 and read draft, published, revision 1, and revision 2. | Revision 1 is immutable; revision 2 has a new digest; the default published read still returns revision 1 until publish. |
| **C1-C07** | Publication head at `casRevision: 1`. | Release two CAS moves with `expectedCasRevision: 1`. | One succeeds and one returns `RevisionConflict`; `casRevision` advances once; `activeVersion` matches the winner; one audit row. |
| **C1-C08** | Any append-only store row. | Attempt update and hard delete. | `AppendOnlyViolation` for both; no row, hash chain, or audit count changes. |

## 6. Gate D — idempotency

| ID | Setup | Action | Expected result |
|---|---|---|---|
| **C1-D01** | Empty tenant; create request with key `k-create`. | Submit the same normalized request twice. | Both calls return the same record ID, revision, and response digest; one row, one revision, one audit row. |
| **C1-D02** | Successful create under `k-create`. | Reuse `k-create` with a different payload. | `IdempotencyConflict`; the original record and audit count are unchanged; no second record is created. |
| **C1-D03** | Same operation and key `k-shared` in A and B. | Create once in each tenant. | Both succeed independently; each tenant resolves only its own record; neither key is observable from the other tenant. |
| **C1-D04** | Empty tenant; two concurrent creates with the same key and request. | Release both through the barrier. | Exactly one write and one audit row occur. Both callers receive the same record ID and response digest; the second never creates or returns a conflict for the same request. |
| **C1-D05** | Create transaction forced to fail before commit. | Retry the same key and request after clearing the fault. | The failed attempt leaves no key, record, revision, or audit. The retry succeeds normally. |
| **C1-D06** | Record at revision 1; update or publish with key `k-write`. | Repeat the same key and same normalized write. | The replay returns the original result; revision and audit count advance only once. A different request under the same key returns `IdempotencyConflict`. |

## 7. Gate E — failed audit writes abort the mutation

| ID | Setup | Action | Expected result |
|---|---|---|---|
| **C1-E01** | Empty tenant; fail the next content revision append. | Create a record. | `AuditWriteFailed`; no current row, revision, idempotency key, or audit row exists. |
| **C1-E02** | Record at revision 1; fail the next content revision append. | Update the record. | `AuditWriteFailed`; current row, revision, snapshot digest, and audit count remain unchanged. |
| **C1-E03** | Editable record at revision 1; fail the next revision append. | Publish, archive, soft delete, and restore, one operation per test. | Each returns `AuditWriteFailed`; `published_revision`, lifecycle, tombstone fields, revision, and audit count are unchanged. |
| **C1-E04** | Decision exists with one event; fail the next `qs_decision_events` append. | Append an approval or execution transition. | `AuditWriteFailed`; no event, no current-status projection change, and no hash-chain extension. |
| **C1-E05** | Metric with value 10; fail the next observation append. | Observe value 12. | `AuditWriteFailed`; no observation and the current value remains 10. |
| **C1-E06** | Publication head at `casRevision: 1`; fail the next publication audit append. | Move the head to version 2. | `AuditWriteFailed`; `casRevision` stays 1, `activeVersion` stays 1, and no audit row exists. |
| **C1-E07** | A specialized audit store; fail its append. | Append through the audit repository directly. | The error is surfaced, never swallowed. The audit list is unchanged and a later retry appends exactly once. |
| **C1-E08** | Representative successful mutations from E01–E06. | Complete each successfully and inspect audit counts. | Each mutation commits exactly one required audit/evidence row in the same transaction; no duplicate audit is written. |

## 8. Gate F — malformed input, bounds, and unresolved state

| ID | Setup | Action | Expected result |
|---|---|---|---|
| **C1-F01** | Tenant with at least one page of rows. | Request limit `0`, limit `101`, and a non-integer limit. | `MalformedQuery` for each; no partial page or unbounded read. The maximum accepted limit is tested at the boundary. |
| **C1-F02** | Valid A cursor and a malformed cursor. | Use the malformed cursor with A; use A's cursor with B. | `MalformedQuery` in both cases; no rows, no widening, no cursor reuse across tenants. |
| **C1-F03** | Query fixtures with valid filters. | Submit an unknown status, invalid date, invalid kind, and a cross-tenant filter value. | Invalid filters return `MalformedQuery`; a cross-tenant filter returns no foreign row or `MalformedQuery`, never a widened result. |
| **C1-F04** | Decision history with a page boundary. | Page through all events with the same filter. | No event is duplicated or skipped; ordering matches `(at, seq, eventId)` and remains stable across calls. |
| **C1-F05** | A required relation points to a nonexistent same-tenant target. | Create or update the source record. | `UnresolvedRelation`; no source row, revision, join, or audit is written. |
| **C1-F06** | Existing tenant A record. | Submit an update that attempts to change `tenant_id` to B. | `MalformedQuery`; the row, tenant, revision, and audit count are unchanged. |

## 9. Gate G — six query contracts

| ID | Setup | Action | Expected result |
|---|---|---|---|
| **C1-G01** | Published A capability graph with inheritance, dependency, conflict pair, and a cycle/dangling-edge case. | Call `getCapabilityGraph('tenant-a')`. | Nodes/edges match the fixture in `(id)` / `(from,to,kind)` order; only published non-tombstoned rows; cycle/dangling edge refuses; B nodes never appear. |
| **C1-G02** | A policy conflict, evidence contradiction, and metric drift; B has the same shapes. | Call `findContradictions('tenant-a')`. | Findings are ordered by `(kind, id)`, capped at 200, preserve source/provenance, and contain no B policy/evidence IDs. No write occurs. |
| **C1-G03** | A active published DAG; also unpublished version, stale head, foreign graph, and malformed graph. | Call `getWorkflowDAG('tenant-a', graphId)` for each. | Active head resolves the exact A version and digest; unpublished/stale/foreign returns `null`; malformed or cyclic graph fails closed; no draft fallback. |
| **C1-G04** | A three-level objective tree, orphan, cycle, and B root. | Call `getObjectiveTree('tenant-a')` and with a root ID. | Deterministic pre-order by `(name,id)`; only published active non-tombstoned nodes; cycle/orphan refuses; B root returns an empty tree; depth 32/node 1,000 bounds set `truncated`. |
| **C1-G05** | A metric with two direct evidence rows, one contradiction, one tombstoned row, and B evidence; 500-row cap case. | Call `getEvidenceForMetric('tenant-a', metricId)`. | Newest-first by `(observedAt DESC NULLS LAST, id ASC)`; only direct same-tenant evidence; tombstoned excluded; foreign metric returns `[]`; cap holds. |
| **C1-G06** | Proposed → approved → executed decision, rollback chain, empty history, B decision, invalid cursor, page boundary. | Call `getDecisionHistory('tenant-a', filters)` for each case. | Events come from `qs_decision_events`; ordering and filters are stable; foreign decision returns no events; invalid cursor/status/date/kind refuses; paging has no duplicate or skip. |
| **C1-G07** | All six query functions and their fixtures. | Enumerate the six contracts and run their positive and foreign-ID cases. | All six exist, none is a TODO/stub, each returns its typed result, and each has at least one fixture-backed pass and one refusal/empty case. |

## 10. Gate accounting and sign-off

| Gate | Cases | Required outcome |
|---|---:|---|
| A — native bootstrap | 4 | All pass; no CMS credential or network path. |
| B — tenancy and relation refusals | 11 | All pass, including every §6 relation in B11. |
| C — revisions and concurrency | 8 | All pass; one winner per CAS race. |
| D — idempotency | 6 | All pass; one write per key and request. |
| E — audit atomicity | 8 | All pass; zero partial mutations. |
| F — input and bounds | 6 | All pass; malformed input never widens scope. |
| G — query contracts | 7 | All pass; six fixtures, no stubs. |
| **Total** | **50** | **50/50 pass, 0 skipped, 0 todo.** |

C1 sign-off requires the evidence artifact from §2.5, the field-mapping ownership gate, and the production read-only export. The matrix does not replace those inputs, and a green matrix against fixture data is not evidence that production data was migrated.
