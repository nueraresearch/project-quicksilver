# C1 implementation sequence (draft)

- **Status:** Planning-only. This document does not add schema, repository, migration, route, test code, production data, or runtime behavior.
- **Date:** 2026-11-17
- **Scope:** The implementation order for the [C1 native schema and repository map](native-cms-c1-schema-repository-map.md) and the [C1 acceptance test matrix](native-cms-c1-acceptance-test-matrix.md). It covers the 21 native collections, 13 derived/audit stores, repository boundary, and six query contracts.
- **Exit rule:** C1 is complete only when all **50** cases pass with **zero skipped, zero todo, and zero failing**, against the selected persistence adapter, with the evidence artifact required by the matrix. This sequence does not change that rule.
- **Non-goals:** No C2 route wiring, production import, provider-status change, Sanity/Strapi demotion, or asset import. A green C1 suite is repository evidence, not migration evidence.

## 1. Sequencing rules

1. **Schema catalog first, behavior in vertical slices.** Register and freeze the complete C1 store catalog at the start so A01 cannot drift. Then implement behavior by aggregate family rather than by table count.
2. **A gate is not complete because the code exists.** Gate closure requires its named cases, positive controls, refusal cases, and evidence. Cases may be implemented out of gate order, but the final report stays grouped by Gates A–G.
3. **Tenant scope is not a later hardening pass.** Every store and repository slice is tenant-qualified from its first write. A slice that cannot refuse a foreign tenant is not mergeable.
4. **Audit is part of the mutation.** The transaction boundary, revision append, and audit/evidence append are designed together. A later “audit cleanup” phase is not acceptable.
5. **Stop on the first failed invariant.** A failed stop point blocks the next stage. Do not build C2 routes, import data, or mark a capability native to work around it.
6. **Evidence is redacted.** Public evidence contains commands, commit, adapter, schema version, timestamps, matrix IDs, counts, and fixture digests; it contains no record bodies, tenant IDs, or private payloads.

## 2. Dependency graph

```text
Stage 0  Entry and design freeze
   |
Stage 1  Harness, schema catalog, bootstrap (A01-A04)
   |
Stage 2  Tenant boundary, stores, relation core (B01-B09, F05-F06)
   |
Stage 3  Revisions, draft/publish, lifecycle, heads (C01-C07)
   |
Stage 4  Audit atomicity and append-only stores (E01-E08, C08)
   |
Stage 5  Idempotency (D01-D06)
   |
Stage 6  Bounds, cursors, full relation inventory (F01-F04, B11)
   |
Stage 7  Six query contracts (G01-G07, B10)
   |
Stage 8  Full 50-case gate and C1 exit
```

Stages 4 and 5 may overlap in implementation, but neither gate may close before both pass. Stage 6 may begin its full relation inventory once Stage 2's stores exist; it closes only after every relation in C1 §6 has a positive and a cross-tenant refusal fixture.

## 3. Stage 0 — Entry and design freeze

**Cases:** none directly. This stage decides whether C1 implementation may start.

**Dependencies:** C0 exit inputs and owner decisions.

**Work:**

- Obtain the signed C0 ownership manifest with zero `ambiguous`, zero `unresolved`, and zero `blocked` retained records.
- Obtain the production read-only export and asset/deletion baseline digests. C1 may start from synthetic fixtures, but C1 sign-off still requires these inputs.
- `playbook` is retained (decided 2026-11-19): A01 expects exactly 21 native collections and 13 derived stores, including `qs_playbooks`.
- Persistence adapter decided (2026-11-19): direct native repositories, no CMS host. Record `adapter` as `direct native repositories (no external CMS host)` in the entry bundle. The composite-key and revision rules are unchanged.
- Freeze the schema catalog version, the C1 §6 relation inventory, the repository error vocabulary, and the planned harness paths.
- Freeze rich-text field designation and the [rich-text parity contract](native-cms-rich-text-parity-contract.md). No plain `text` field becomes Portable Text without an owner-approved C0 mapping.
- Confirm the tenant registry and principal-to-tenant bindings are the only tenant source; no environment default is permitted.

**Evidence artifacts:**

- `c1-entry-bundle`: signed C0 ownership manifest digest, production export digest, asset/deletion baseline digest, playbook decision, adapter/chassis decision, schema catalog version, relation inventory digest.
- The owner and Security reviewer sign the entry bundle. Private inputs stay outside the worktree.

**Stop point:**

- No schema or test code starts while ownership is unresolved, the production export is missing, the adapter choice is undecided, or `playbook` changes the expected store count without an updated matrix.
- A type-wide ownership rule does not substitute for the signed ownership manifest.

## 4. Stage 1 — Harness, schema catalog, and bootstrap

**Cases:** C1-A01, C1-A02, C1-A03, C1-A04.

**Dependencies:** Stage 0.

**Work:**

- Create the C1 test runner, deterministic clock and ID source, two-tenant fixture module, fail-audit seam, concurrency barrier, and read-only `rawDump` seam described in the matrix.
- Register the complete store catalog: 21 native collections (including `qs_playbooks`) and 13 derived/audit stores. Exclude the two OIDC adapters.
- Construct every repository and the six query entry points without a CMS client, network call, or credential read.
- Require explicit `tenantId` on every repository and query call; reject missing or blank tenant with `MalformedQuery`.
- Prove `QUICKSILVER_TENANT_ID` and every default-tenant path have no effect.
- Implement the minimal organization create/read path needed for A02 without claiming the full organization aggregate is complete.

**Evidence artifacts:**

- `c1-bootstrap-report`: A01–A04 pass/fail, store enumeration manifest, counts (21 native, 13 derived, 0 OIDC), fixture manifest digest, environment-absence proof, and no-network/no-credential result.
- `c1-schema-catalog`: canonical store names, keys, tenant columns, revision/lifecycle columns, relation inventory reference, and schema version.
- `c1-fixture-manifest`: tenant A/B roots, collisions, deterministic IDs, fixed clock, graph coverage, append-only coverage, and relation-manifest digest.

**Stop point:**

- Stop if A01 does not enumerate exactly 21 + 13 stores, if any repository constructs a CMS client, if any credential is read, or if a missing tenant can fall back to an environment value.
- Do not proceed to relation writes while the bootstrap is fixture-only or the store catalog is still moving.

## 5. Stage 2 — Tenant boundary, stores, and relation core

**Cases:** C1-B01, C1-B02, C1-B03, C1-B04, C1-B05, C1-B06, C1-B07, C1-B08, C1-B09, C1-F05, C1-F06.

**Dependencies:** Stage 1.

**Work:**

- Implement tenant-qualified primary keys, composite foreign keys, and repository checks for every relation in the first vertical slice: organization, department, entity, capability, policy, objective, workflow, automation workflow, publication heads, decisions, evidence, metrics, agents, and operator records.
- Expose the complete list surface for all 21 native collections and 13 derived stores, even where a specialized write path is scheduled later. B03 must not pass on a partial repository list.
- Implement tenant-bound reads, lists, and cursors; a foreign ID returns `NotFound` with no existence signal; a foreign cursor returns `MalformedQuery`.
- Implement same-tenant relation writes with no partial joins: department members/capabilities, decision context, workflow/agent heads, commitment/contact/decision links, scheduled-item links, and drafted-communication links.
- Reject required relations to a missing same-tenant target with `UnresolvedRelation`.
- Reject an attempt to change `tenant_id` with `MalformedQuery`.
- Register every relation in C1 §6 in the fixture manifest, even when its full parameterized suite arrives in Stage 6.

**Evidence artifacts:**

- `c1-tenancy-report`: B01–B09, F05, F06 results; collision proof; foreign-read/list/cursor results; relation write refusals; `rawDump` proof that no partial join or audit row was written.
- `c1-relation-coverage-partial`: every implemented relation, its source/target stores, positive fixture, cross-tenant refusal fixture, and the not-yet-implemented list.
- `c1-cursor-report`: tenant binding, replay behavior, malformed cursor, and no cross-tenant page.

**Stop point:**

- Stop if a foreign tenant read, list, relation write, head move, or cursor succeeds; if a foreign ID leaks a body or existence detail; or if a relation can insert one endpoint without the other.
- Do not start revisions or idempotency while a tenant-boundary failure remains.

## 6. Stage 3 — Revisions, draft/publish, lifecycle, and heads

**Cases:** C1-C01, C1-C02, C1-C03, C1-C04, C1-C05, C1-C06, C1-C07.

**Dependencies:** Stage 2 for editable records and publication heads.

**Work:**

- Implement the current-row projection plus immutable `qs_content_revisions` snapshots.
- Require `expectedRevision` or `If-Match`; stale updates, publishes, archives, soft deletes, and restores return `RevisionConflict`.
- Implement draft/published reads, published revision pointers, archive, soft delete, and restore. Default reads return the published revision; draft reads require explicit editor scope.
- Implement CAS for workflow and agent publication heads with exactly one winner.
- Keep revision 1 immutable after revision 2; a publish points to a specific revision, not a copied document.

**Evidence artifacts:**

- `c1-revision-report`: C01–C07 results, snapshot and digest verification, published-pointer semantics, lifecycle transitions, and immutable revision proof.
- `c1-concurrency-report`: barrier release result, one winner/one conflict, final revision/`casRevision`, active-version match, and exactly one revision/audit row.
- `c1-head-report`: one head per tenant/graph and tenant/agent, CAS values, and stale-head refusal.

**Stop point:**

- Stop if a stale write can overwrite a current row, a draft can be returned as published by default, a publish moves the pointer on a stale revision, or two CAS writers both succeed.
- Do not add idempotency replay until the revision and CAS semantics are stable.

## 7. Stage 4 — Audit atomicity and append-only stores

**Cases:** C1-E01, C1-E02, C1-E03, C1-E04, C1-E05, C1-E06, C1-E07, C1-E08, C1-C08.

**Dependencies:** Stage 3 for editable mutations and Stage 2 for decision, metric, and publication stores.

**Work:**

- Make the content revision/audit append part of the same transaction as the primary create, update, publish, archive, soft delete, or restore.
- Implement decision event append, metric observation append, workflow/agent publication audit append, department and authorization audit append, and the direct audit-repository append path.
- Implement append-only enforcement for audit, ledger, evaluation, trace, review, and generated-snapshot stores: no update, no hard delete.
- Preserve hash-chain extension where the source has one; a failed append must not extend the chain.
- Ensure an audit-append failure rolls back the primary write and any idempotency row created by that transaction.

**Evidence artifacts:**

- `c1-audit-failure-report`: E01–E08 failure injection per mutation, exact error, primary-write rollback, audit-count delta, and hash-chain result.
- `c1-append-only-report`: C08 update/delete refusal for each append-only store class, with no row, chain, or audit-count change.
- `c1-transaction-seam-report`: the fail-audit seam fires after the primary write reaches the transaction and before commit.

**Stop point:**

- Stop if any mutation commits without its required audit/evidence row, any audit failure is swallowed, any append-only store accepts update/delete, or a failed chain append advances the chain.
- Do not call a repository “complete” while its audit failure path is unproven.

## 8. Stage 5 — Idempotency

**Cases:** C1-D01, C1-D02, C1-D03, C1-D04, C1-D05, C1-D06.

**Dependencies:** Stage 3 create/update/publish paths and Stage 4 transaction boundaries.

**Work:**

- Implement tenant-scoped idempotency keys with the normalized request digest and replay result.
- Return the original record ID, revision, and response digest for a repeated identical request.
- Return `IdempotencyConflict` for the same key with a different request.
- Make concurrent same-key requests produce one effect and the same result.
- Ensure a transaction that fails before commit leaves no key, record, revision, or audit row.
- Keep keys invisible across tenants.

**Evidence artifacts:**

- `c1-idempotency-report`: D01–D06 results, duplicate/concurrent requests, same-key/different-payload conflict, cross-tenant isolation, and failed-transaction cleanup.
- `c1-idempotency-digest`: normalized request digest and response digest for each fixture, with no private payload.

**Stop point:**

- Stop if a replay creates a second row/revision/audit, a different payload under the same key is accepted, a key is visible across tenants, or a failed transaction leaves a key.
- Do not expose idempotency to C2 routes before the key boundary is proven.

## 9. Stage 6 — Bounds, cursors, filters, and full relation inventory

**Cases:** C1-F01, C1-F02, C1-F03, C1-F04, C1-B11.

**Dependencies:** Stage 2 stores/relations, Stage 3 lifecycle, Stage 4 audit, and Stage 5 replay behavior.

**Work:**

- Enforce limit 1–100, reject 0, 101, and non-integer limits, and test the accepted boundary.
- Bind cursors to tenant, filter, and ordering; reject malformed or cross-tenant cursors.
- Validate status, date, kind, and cross-tenant filter values; invalid filters refuse; foreign filter values never widen a result.
- Prove decision-history paging at the repository boundary has no duplicate or skipped event and follows `(at, seq, eventId)`; G06 later exposes the same ordering through the query contract.
- Run the parameterized relation suite over every C1 §6 relation: one same-tenant success and one cross-tenant refusal per relation.
- Fail the suite if any relation lacks a fixture.

**Evidence artifacts:**

- `c1-bounds-report`: F01–F04 results, page-boundary proof, filter validation, cursor binding, and no-widening evidence.
- `c1-relation-coverage`: every C1 §6 relation with source, target, cardinality, positive fixture, cross-tenant fixture, result, and missing count (must be 0).
- `c1-query-safety-precheck`: foreign-ID behavior and no-write proof for the query paths used by B10.

**Stop point:**

- Stop if any read is unbounded, a cursor can be reused across tenants or filters, an invalid filter broadens scope, paging duplicates/skips, or any relation has no refusal fixture.
- Do not declare Gate B complete until B11 is included.

## 10. Stage 7 — Six query contracts

**Cases:** C1-G01, C1-G02, C1-G03, C1-G04, C1-G05, C1-G06, C1-G07, C1-B10.

**Dependencies:** Stage 2 relations, Stage 3 published/lifecycle state, Stage 4 decision events, Stage 6 bounds and relation coverage.

**Work:**

- Implement `getCapabilityGraph`, `findContradictions`, `getWorkflowDAG`, `getObjectiveTree`, `getEvidenceForMetric`, and `getDecisionHistory`.
- Preserve the C1 return types, tenant argument, deterministic ordering, bounds, and refusal/empty behavior.
- Resolve published active records only; never fall back to drafts, foreign rows, or a lower-tenant projection.
- Keep every query read-only; no finding, graph, or history read writes authority or audit state.
- Replace the six TODO functions in `quicksilver/query/index.ts`; no stub may remain.

**Evidence artifacts:**

- `c1-query-contract-report`: G01–G07 and B10 results, one fixture per contract, ordering, caps, truncation, foreign-ID empty/null behavior, refusal cases, and no-write proof.
- `c1-query-fixtures`: capability graph, contradictions, workflow DAG, objective tree, metric evidence, and decision history fixtures with digest.
- `c1-query-stub-check`: enumeration showing all six contracts exist and none is a TODO, stub, or unconditional empty result.

**Stop point:**

- Stop if any contract is missing or a stub, any foreign row/ID appears, any ordering or bound differs from the contract, or any query writes state.
- Do not start C2 route adaptation from partial query results.

## 11. Stage 8 — Full 50-case gate and C1 exit

**Cases:** all C1-A01 through C1-G07.

**Dependencies:** Stages 0–7.

**Work:**

- Run the complete suite with `npm run native:c1:test` or the implemented equivalent, with matrix IDs registered and no skipped/todo cases.
- Produce the evidence artifact from the matrix: command, commit, adapter, schema version, timestamp, matrix IDs, pass/fail counts, and fixture manifest digest.
- Verify the positive controls still fail when a guard is removed; a blanket rejection must not pass.
- Attach the C0 signed ownership manifest, production export digest, and asset/deletion baseline digest to the C1 exit package.
- Obtain C1 sign-off from the owner; the Security reviewer confirms the committed evidence is redacted. A green fixture suite is not a production-import authorization.

**Evidence artifacts:**

- `c1-acceptance-report`: 50/50, zero skipped, zero todo, zero failing; grouped A–G; adapter and schema version; commit and command; fixture manifest digest; redacted.
- `c1-exit-bundle`: acceptance report, C0 ownership manifest digest, production export digest, asset/deletion baseline digest, entry-bundle decisions, and sign-off.
- `c1-evidence-index`: private-to-public evidence map; private artifacts remain outside the worktree.

**Stop point:**

- Stop if any case is missing, skipped, todo, or only supported by a stub; if a foreign-tenant case leaks; if the evidence artifact cannot be reproduced; or if C0 ownership/export inputs are absent.
- Do not begin C2, import production data, change provider status, or claim native content parity from C1 alone.

## 12. Evidence artifact contract

Every artifact above carries at least:

| Field | Requirement |
|---|---|
| `command` | Exact test or verification command. |
| `commit` | Commit under test. |
| `adapter` | Persistence adapter/chassis and version. |
| `schemaVersion` | C1 schema catalog version. |
| `timestamp` | UTC run time. |
| `matrixIds` | Every case ID exercised; missing IDs fail the artifact. |
| `counts` | Pass, fail, skipped, todo. |
| `fixtureDigest` | Digest of the deterministic fixture manifest. |
| `redaction` | Public copy contains no tenant IDs, record bodies, payloads, or private paths. |

Private failure logs and `rawDump` output remain in the private evidence store. The committed artifact contains only the redacted summary and digests.

## 13. Stop-point summary

| After stage | Hard stop if | Resume only when |
|---|---|---|
| 0 | Ownership, production export, playbook, or adapter decision is missing. | Signed entry bundle exists; store count is stable. |
| 1 | Store count differs, CMS client is constructed, credential is read, or tenant can fall back. | A01–A04 pass with no-network proof. |
| 2 | Foreign read/write/cursor succeeds, relation joins partially, or existence leaks. | B01–B09, F05–F06 pass; relation manifest is complete for implemented slices. |
| 3 | Stale write overwrites, draft is default, or two CAS writers win. | C01–C07 pass; one winner and immutable revisions proven. |
| 4 | Mutation commits without audit, audit failure is swallowed, or append-only accepts mutation. | E01–E08 and C08 pass. |
| 5 | Replay duplicates, same key/different payload is accepted, or failed transaction leaves a key. | D01–D06 pass. |
| 6 | Read is unbounded, cursor crosses tenants, paging duplicates/skips, or a relation lacks refusal evidence. | F01–F04 and B11 pass. |
| 7 | Any query is missing/stubbed, foreign row appears, ordering/bound drifts, or query writes. | G01–G07 and B10 pass. |
| 8 | Any of the 50 is missing/skipped/todo, or C0 inputs are absent. | 50/50 and signed C1 exit bundle. |

## 14. Explicit non-goals

This sequence does not:

- create schema, repository, migration, route, fixture, or test code;
- import production data or create native tombstones;
- change Sanity, Strapi, OIDC, Resend, or model provider status;
- authorize C2, C6, C7, or a tenant cutover;
- replace the C1 acceptance matrix with a progress checklist.

No source file, schema, repository, route, provider, or runtime behavior is changed by this document.
