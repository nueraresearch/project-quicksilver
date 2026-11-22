# Native CMS cutover plan (draft)

- **Status:** Draft for owner review — no implementation, migration, or provider change is authorized by this document.
- **Date:** 2026-11-16
- **Scope:** Replacing the Sanity content plane with the Quicksilver-owned CMS. This refines Stages 1–3 of [native local operation](native-local.md); local identity, inference, SMTP, packaging, and phone remain separate stages.
- **Governing records:** [ADR 0001](adr-0001-native-first-ownership.md) (R1–R4), [ADR 0003](adr-0003-native-local-operation.md) (L1–L5), [ADR 0005](adr-0005-sanity-demotion-global-gate.md) (proposed global-gate decision), [native capability matrix](native-capabilities.json) v1, [parity tests](parity-tests.md) P-118/P-121, and the [threat model](threat-model.md).
- **Decision this plan seeks:** demote Sanity from a required backend to an optional, read-only adapter without losing content, authority, tenant isolation, audit, or rollback.

## 1. Guardrails

These are constraints, not stage objectives.

1. **One authoritative writer.** Never run uncoordinated dual writes between Sanity and the native CMS. Cut over one tenant/deployment at a time, freeze or drain writes for final synchronization, and keep a tested rollback path.
2. **Tenant identity comes from the authenticated principal.** A `tenantId` field, request body, query string, or agent output is never the isolation boundary.
3. **Fail closed.** Missing configuration, an unresolved tenant, a cross-tenant relation, a stale revision, or a failed audit write refuses the operation. There is no silent fallback to another provider.
4. **No feature loss.** Every retained Sanity schema, field, relation, validation, draft/publish behavior, admin workflow, query, API contract, seed path, context path, and audit behavior must have a native equivalent. A removed feature needs explicit owner approval and a migration note.
5. **Preserve identity and history.** Keep stable document IDs, references, creation/update times, draft markers, revision/audit history, and tenant scope. Unknown fields are preserved or explicitly mapped; they are not silently dropped.
6. **Native means ownership, not rewriting infrastructure.** The database, TLS, object store, and model runtime may be audited libraries or bundled local services. Sanity and standalone Strapi may remain optional adapters, but neither may be required by a built-in install.
7. **Real exports, not fixtures, are the cutover evidence.** Fixtures prove the harness works; they do not prove migration parity.
8. **R1 — retire after replacement.** Sanity may not be demoted in the same milestone that introduces its replacement. Replacement evidence lands first; demotion is a later, separately approved change.

## 2. Current baseline (matrix v1, updated 2026-11-19; API counts re-measured at HEAD)

The executable gate currently exits **1**:

- **23 core capabilities:** 1 native, 6 partial, 16 absent.
- **14 content capabilities:** 0 native, 5 partial, 9 absent.
- Sanity is still `required`; the Strapi chassis is an optional, non-runtime-registered scaffold and is not the C1 chassis (decided 2026-11-19: direct native repositories, [C0 packet §3](native-cms-c0-unblock-packet.md#3-decision-2--persistence-adapterchassis)).
- The current Sanity Studio defines **36 schema types**.
- **48 route files / 51 operations**, matching the 51 operations declared in `docs/api/openapi.json`. The invocation harness enumerates all 51 with **0 unimportable** modules, validates **37 of 51** against the declared response schema, and leaves **14 of 51** not successful: 8 answer 500 (unconfigured model provider, product-memory root, or entity store), 5 answer 503, and 1 answers 401 (no browser session). Those 14 need native seeded data or another configured dependency. Measured with `QS_SCHEMA_REPORT=1` against `apps/web/lib/api-response-schema.test.ts`.
- The older **42 of 46** figure is the pre-operator credential-baseline snapshot at `3f7261c` (45 route files / 46 operations), not a second inventory: PR #120 added three operator route files and five operations, producing today's 48 files / 51 operations. See [C0's reconciliation](native-cms-c0-inventory.md#the-46-importable-handlers-figure).
- The rehearsal harness proves export-to-export parity, snapshot integrity, and JSONL restore only. It has **not** run against a real Sanity export, does not prove tenant refusals or a deployed restart/restore, and has no owner sign-off.

No cutover is authorized from this baseline.

## 3. Ordered stages

### C0 — Baseline, inventory, and scope freeze

**Purpose:** make the migration finite and testable before building it.

Deliverables:

- A versioned mapping of all 36 Sanity schema types to one of: native collection, derived/audit store, optional adapter, or owner-approved retirement. The draft is [C0 cutover inventory](native-cms-c0-inventory.md). The remaining `playbook` decision is framed in the [retain/retire decision brief](native-cms-playbook-decision-brief.md).
- A route/query inventory: every `apps/web` handler, GROQ query, Studio action, seed script, Context MCP call, and agent-context read.
- A data inventory by `_type`, tenant, draft/published state, reference graph, asset count, and document count.
- A tenant-ownership resolution pass and signed redacted manifest, following the [C0 ownership resolution and redacted manifest procedure](native-cms-c0-ownership-resolution-manifest.md). It must show zero unresolved, ambiguous, or blocked retained records before C1 starts.
- A read-only baseline export of content, assets, and deletion evidence, with verified manifests. Record project ID, dataset, export time, counts, status totals, and overall digests; never commit credentials or private data. The procedure is [C0 asset and deletion baseline procedure](native-cms-c0-asset-deletion-baseline.md).
- A written list of known behavior differences and the owner who accepts each one.

**Exit gate:** every current content path maps to a capability row or an approved retirement; no route, schema type, or Studio workflow is unclassified; the baseline content, asset, and deletion manifests verify; the owner signs the scope. No Sanity writes occur in this stage.

### C1 — Native content model and tenant-scoped repositories

**Purpose:** replace the data model and query boundary, not just copy schemas.

Work:

- The design draft for this stage is [C1 native schema and repository map](native-cms-c1-schema-repository-map.md). It defines the collections, composite tenant relations, revisions, derived/audit stores, repositories, and six query contracts; it is not an implementation claim.
- The planning order is the [C1 implementation sequence](native-cms-c1-implementation-sequence.md). It adds dependencies, evidence artifacts, and stop points; it is planning-only.
- Before C1 implementation, complete the [field-level source-to-native mapping and tenant ownership registry](native-cms-field-mapping-tenant-registry.md). Every retained field and every record/asset tenant assignment must be resolved; the registry is a reviewed input, not an inferred default.
- Register and run the native CMS store catalog without an external Strapi project or CMS host (chassis decided 2026-11-19: direct native repositories). The ten existing ontology collection schemas are the starting point, not the complete model.
- Add native equivalents for every retained Sanity type: decisions and audit, evaluations, agent catalog and publication records, workflow publication/revision records, chat and inbox, reviews, commitments, contacts, scheduled items, drafted communications, and the audit/authority records that back them.
- Implement the six query contracts in `quicksilver/query/index.ts`: capability graph, contradictions, workflow DAG, objective tree, evidence for metric, and decision history. They are implemented and green on the fixture store ([C1 query contract report](native-cms-c1-evidence/c1-query-contract-report.md)); no route calls them yet.
- Enforce same-tenant composite relations in the repository layer; a `tenantId` column alone is not a boundary.
- Implement filters, sorting, pagination, draft/publish, revisions, idempotency keys, and optimistic concurrency.
- Keep append-only decision/audit records append-only; a failed audit write aborts the mutation.

**Exit gate:** native schemas and repositories load with Sanity and external Strapi unset; cross-tenant relations and queries refuse; malformed input refuses; concurrent updates return a conflict rather than overwriting; all six query contracts have fixtures. The gate is executable only through the [C1 acceptance test matrix](native-cms-c1-acceptance-test-matrix.md): all 50 cases pass with zero skipped and zero todo.

### C2 — Native stores, routes, and API contract

**Purpose:** move the serving path from Sanity documents to native repositories.

Work:

- Wire decisions, evaluations, authorization/execution audits, agent catalog, workflow publication, chat, and inbox to native stores.
- Keep the NQC Kernel as the authority. Content storage does not approve, execute, or grant capability.
- Port every data-backed web route and host content store to the native repositories.
- Public delivery follows the [native CMS public-delivery contract](native-cms-public-delivery-contract.md) for URL stability, slug aliases, publish/delete events, and cache revalidation. C2 does not wire the public plane before that contract is approved.
- Validate all 51 API operations against native seeded data, including the 14 that currently need real data or per-route provider stubs.
- Preserve 401/403 behavior and add explicit cross-tenant 404/403 tests.

**Exit gate:** no retained route reaches Sanity; the native path answers with Sanity unset; P-118 has 51/51 operations validated with no CMS-caused 401/503; every route has an auth and tenant-refusal test.

### C3 — Native administration, seeding, and context retrieval

**Purpose:** replace Studio and Context MCP, not just the database.

Work:

- Build the native admin/editor for every retained content type: create, edit, preview, validate, relate, draft, publish, archive, soft delete/restore, and inspect audit history.
- Implement role-aware access and record who changed what. Admin authority remains separate from kernel authority.
- Replace Sanity seed/demo scripts with deterministic native fixtures that work on a clean install.
- Implement deterministic, bounded, provenance-preserving context assembly from tenant-scoped native queries. Every cited ID must resolve to a native record.
- Remove the Context MCP dependency from the core query path; keep it optional only if a deployment explicitly selects it.

**Exit gate:** a user can perform every current Studio workflow in the native admin; the clean install seeds and runs the demo; context answers cite real native records and refuse cross-tenant or fabricated IDs; no Sanity Studio is required.

### C4 — Isolation, backup/restore, and credential-free startup

**Purpose:** close the operational gaps that make demotion unsafe.

Work:

- Complete end-to-end tenant isolation tests for every collection, relation, query, route, and context path, including two tenants with colliding IDs.
- Add native backup and restore covering the database, media/object store, audit records, and configuration (never secrets in backups). Test restore into a clean install and after a restart.
- Define and test the retention/lifecycle policy for decisions, chat, inbox, evaluations, and audit records.
- Make the clean install work with every `SANITY_*`, `NEXT_PUBLIC_SANITY_*`, and external-Strapi variable unset. The test must prove the variables are absent, not merely empty.

**Exit gate:** `content.tenant-isolation` and `content.backup-restore` are native; the clean-install proof is recorded for `content.credential-free-startup`, whose matrix row stays `partial` because it is the removal gate itself and may be marked native only after every other core row; a restore drill preserves decisions, approvals, audit chains, and tombstones; credential-free CI (`verify`, web build, `check:clean-install`) passes without a CMS account.

### C5 — Real-export rehearsal and rollback drill

**Purpose:** prove the migration and the way back on real data.

This stage is detailed in sections 5 and 6. It uses a disposable dataset first, then a read-only production export into staging, and only then a frozen production cutover window.

**Exit gate:** real production-clone export compares with zero missing, extra, or changed active content records; the deletion/tombstone reconciliation gate in section 5.6 passes; the asset export/import/verify gate in section 5.5 passes; active and tombstone snapshots verify and restore; reverse migration back to Sanity, including tombstones, passes on the disposable dataset; the rollback drill meets the RPO/RTO targets in section 6 and is timed and recorded; the Rollback Authority signs every accepted difference.

### C6 — Read-shadow canary and one-tenant write cutover

**Purpose:** switch authority for one named canary tenant with bounded exposure. This is not a global Sanity demotion.

**Canary boundary:** C6 changes the authoritative writer for one tenant/deployment only. Sanity remains `required` in the matrix and remains authoritative for every other tenant; the required build, CI, seed, and runtime paths do not change. A successful C6 canary is evidence for C7, not a demotion. Only C7 may set `providers[].sanity.status` to `optional` or remove Sanity from required paths.

Sequence:

1. **Read shadow:** native reads the same tenant data while Sanity remains the writer. Compare API responses, asset delivery, and soft-delete/purge 404/410 behavior; record differences. Run for at least 7 consecutive days and exercise every core content route.
2. **Write freeze:** stop Sanity writes for the selected tenant only, export the final content, asset, and deletion delta, import it, and compare again.
3. **Cutover:** make native the single authoritative writer for that tenant; make that tenant's Sanity path read-only. Do not dual-write.
4. **Observation:** run for at least 14 consecutive days of real use. If no real use occurs, the cutover is not complete.
5. **Rollback drill:** perform the applicable rollback path on staging before the first production native write. After the first native write, rehearse R2 on staging against a copy of the first native delta; do not roll back production for a drill.

**Tenant fallback path:** fallback is tenant-scoped and never changes the global provider status.

1. **Before the first native write (R1):** switch the canary tenant's reads back to Sanity. Native remains read-only or is discarded; no reverse migration is needed. Target: RPO 0, RTO 15 minutes.
2. **After native writes (R2):** stop native writes for the canary tenant, export the tenant's native delta including assets and the tombstone ledger, reverse-import into the canary tenant's Sanity records (or its isolated dataset, if one is used), compare active records, assets, and deletions, then unfreeze Sanity for that tenant. The import must not write another tenant's records. Target: RPO 0 committed native writes, RTO 4 hours.
3. **If the reverse import fails:** restore the pre-cutover Sanity snapshot covering the canary tenant and accept only the data loss the Rollback Authority explicitly approves. If that snapshot is dataset-wide, reconcile or replay every other tenant's later writes before unfreezing; record an incident. Do not open Sanity writes globally to work around a tenant-scoped failure.
4. **After fallback:** the canary tenant is Sanity-authoritative again; the native tenant copy is non-authoritative and retained or archived pending reconciliation. Other tenants remain on Sanity throughout, and Sanity stays globally `required`.

The fallback switch must be tenant-scoped and audited. A tenant fallback does not satisfy C6, does not satisfy section 7, and must not be reported as a successful canary.

**Exit gate:** zero unresolved divergence across content, assets, and deletions for the canary tenant; no Sev-1 or Sev-2 data-integrity incident; P-121 passes against the native path; the rollback drill meets the R2 target of RPO 0 and RTO 4 hours; the Rollback Authority signs the canary evidence and confirms that only the named tenant moved. This gate does not demote Sanity or unblock C7.

### C7 — Demote Sanity to optional

**Purpose:** change the default only after the replacement is proven.

Work:

- Set the matrix provider `sanity.status` to `optional` and update its R1 disposition.
- Remove Sanity and external Strapi from required build, CI, seed, and runtime configuration; keep any optional adapter's own test/build job separate.
- Keep the Sanity adapter read-only by default. Any write-back mode requires explicit conflict resolution and audit semantics.
- Retain the Sanity dataset and read-only credentials for 30 days after demotion.

**Exit gate:** every condition in section 7 is met, `npm run native:gate` exits 0, and a dated evidence record is reviewed and signed by the Rollback Authority. Demotion is a separate milestone from the replacement work (R1).

## 4. Acceptance gate for each core content capability

A row becomes `native` only when its implementation and a test exist, the test is registered in the credential-free suite, and the negative cases below refuse. The matrix requires at least one test path as evidence for a `native` claim.

| Capability | Native exit criteria | Negative evidence that must pass |
|---|---|---|
| `content.ontology` | Every retained Sanity type, field, relation, validation, draft/publish rule, reference, and tenant field has a native schema. The CMS chassis is registered and runs without an external Strapi project. Unknown fields are preserved or explicitly mapped. | Cross-tenant relation refused; invalid field/type refused; illegal draft/publish transition refused; a schema with an unresolved reference fails closed. |
| `content.query.tenant` | Every current query path is ported: filters, sorting, pagination, graph traversal, contradictions, workflow DAG, objective tree, evidence-by-metric, and decision history. Tenant comes from the principal. Ordering is deterministic and page bounds are enforced. | Query with no principal is 401; cross-tenant query returns no foreign rows or 403; client-supplied tenant override is ignored or refused; malformed cursor/filter is refused. |
| `content.decisions` | Native durable decisions, approvals, rejections, execution audits, policy snapshots, revision/fingerprint binding, and append-only history. Human-only transitions remain human-only; duplicate execution is idempotent. Decisions and authorization/execution audits are append-only and may not be hard-deleted; retention changes are metadata-only and audited. | Agent approval refused; stale fingerprint/revision returns 409; duplicate execute does not duplicate the effect; audit-write failure aborts the mutation; deletion of an audit record is refused. |
| `content.agent-catalog` | Native catalog definitions, publication heads/audits, digest validation, active-only resolution, and profile bindings. Agent runs and catalog routes read native records. | Digest mismatch refuses; unpublished/inactive definition is not runnable; cross-tenant catalog entry is invisible; missing catalog entry fails closed. |
| `content.workflow-publication` | Native publication heads, revisions, audit records, digest pinning, publish/rollback, and conflict detection. Publication history is append-only/inspectable. | Stale head returns 409; unauthorized publish is 403; missing/mismatched digest refuses; rollback cannot target an unknown revision. |
| `content.chat-inbox` | Native chat history and inbox items with tenant scope, pagination, truncation reporting, retention, and soft-delete tombstones. Sources resolve to retained records; normal reads exclude tombstones. | Cross-tenant read is 404/403; capped list reports `truncated`; deleted item is no longer returned; missing principal is 401. |
| `content.studio-admin` | Native admin/editor covers every retained content workflow: create, edit, preview, relations, validation, draft/publish, archive, soft delete/restore, and audit-scoped history. Role checks are enforced server-side. | Unauthorized editor is 403; invalid relation/field is refused; publish without permission is 403; unauthorized delete/restore is 403; failed audit write aborts the edit. |
| `content.seed-fixtures` | Deterministic native seed/demo fixtures on a clean install. IDs and digests are stable; the demo needs no external dataset or credential. | Re-running the seed is idempotent; seed refuses production/destructive mode; a missing fixture fails rather than silently skipping. |
| `content.context-retrieval` | Deterministic, bounded context built from tenant-scoped native queries, with provenance for every cited record. Tombstoned records are excluded. Sanity Context MCP is not required. | Fabricated or missing ID is rejected; cross-tenant source is excluded; tombstoned source is excluded; unavailable model/provider produces an explicit refusal or dry-run, never a silent provider switch. |
| `content.migration-rehearsal` | A real Sanity export, canonical projection, native import/export, asset export/import/verify, deletion evidence and tombstone reconciliation, zero-divergence compare, snapshot verify, restore, reverse migration, and Rollback Authority sign-off. Evidence records counts, digests, asset totals, deletion counts, commands, date, and differences. | One changed/missing/extra active record fails; one missing asset, unresolved reference, or SHA-256 mismatch fails; one unexplained missing, unexpected deletion, restored-missing record, restore-audit mismatch, unresolved resurrection, or tombstone digest mismatch fails; duplicate `_id`, empty, or malformed input exits 2; tampered snapshot fails verify; restore re-verifies the written data; no stage reports success on a skipped check. |
| `content.api-response-contract` | All 51 operations validate against native seeded data; every handler has auth/tenant coverage; no route returns 401/503 merely because a CMS is unconfigured. Soft-deleted reads return 404, purged reads return 410, and audit-scoped reads have an explicit response. The OpenAPI version and response schemas remain current. | A control mutation to a response schema fails the suite; request-validation 400/422 is not counted as response-schema evidence; missing/unknown credentials refuse; a tombstoned record is never returned as active. |
| `content.tenant-isolation` | Every native collection, relation, query, route, admin action, and context path derives tenant from the principal. Same-tenant composite relations are enforced in the repository, not only in the UI. Two tenants with colliding IDs remain isolated, including tombstones. | Cross-tenant relation refused; cross-tenant read is 404/403; cross-tenant tombstone is invisible; foreign tenant ID in a body is ignored/refused; unauthenticated request is 401. |
| `content.backup-restore` | Native backup includes database, media/object store, tombstones, audit records, and configuration; restore works into a clean install and survives restart. Backup cadence supports the R3 target of RPO 15 minutes and RTO 4 hours. Retention and disaster-recovery procedure are documented and tested. | Corrupt/partial backup fails closed; restored audit chain verifies; a tombstoned or purged record is not silently resurrected; a restore that loses a decision/approval/tombstone is a failure. |
| `content.credential-free-startup` | `git clone` + `npm ci` + native setup + `npm run dev` works with all Sanity and external-Strapi variables unset. Core content features, seed, admin, and API work against the native backend. This row is the removal gate itself and is marked native last. | A test proves the variables are absent; missing CMS configuration never falls back to a mock in production; core routes do not answer 401/503 because a CMS is unset. |

The deletion/audit gate in section 5.6 applies to every content row. Decisions, approvals, and authorization/execution audits remain append-only and may not be hard-deleted.

**Global-gate note:** the current executable gate checks every `core: true` row, not only the 14 content rows. At matrix v1 that is 23 rows, including local identity, local model installation, STARTTLS/inbound email, and live native delivery. Under the rules as written, Sanity cannot be demoted until those rows also pass, unless a new ADR explicitly narrows the gate. [ADR 0005 (Proposed)](adr-0005-sanity-demotion-global-gate.md) preserves the global gate and sequences C7 behind the other core capabilities. Editing only `providers[].status` does not make the gate pass.

## 5. Real-export rehearsal

### 5.1 Artifacts

For each rehearsal, retain:

- `source-raw.jsonl` — the Sanity export as NDJSON, including `_id`, `_type`, `_rev`, timestamps, drafts, references, tenant fields, and unknown fields.
- `source-parity.jsonl` — the versioned canonical projection used for comparison.
- `native-export.jsonl` — the native active-record export in the same projection.
- `native-tombstones.jsonl` — the native tombstone export, kept separate from active records.
- `deletions.jsonl` — the deletion-evidence ledger, including the source, pre-delete digest, and tombstone digest for every claimed deletion.
- `scope.json` — project ID, dataset, export time, included types, draft/published policy, filters, token scope, and counts. A scope change is not a deletion.
- `assets-manifest.json` — per asset: Sanity document ID, native asset ID, status (`active`, `tombstoned`, `purged`, `archived`), MIME type, byte size, SHA-256, source URL, storage key, dimensions/metadata, reference count, tenant IDs, and verify result. Binary assets are backed up separately and hashed.
- `snapshot/` — the rehearsal harness manifest plus active records.
- `tombstone-snapshot/` — a separate manifest and records for tombstones, with counts and digests verified independently.
- `evidence.md` — project/dataset, export time, counts by type/tenant, commands, digests, active/deleted/tombstone counts, differences, rollback result, and owner sign-off.

### 5.2 Canonicalization rules

- One JSON object per line, keyed by a non-empty unique `_id`.
- Recursively sort object keys; preserve arrays in order.
- Preserve `_id`, `_type`, `tenantId`, references, `_createdAt`, `_updatedAt`, and draft markers.
- Exclude only fields that the native store legitimately regenerates, and exclude them from **both** sides through a versioned projection. Never exclude a business, authority, audit, tenant, or reference field to make a comparison pass.
- Preserve drafts separately. A published document and its `drafts.*` counterpart are distinct records; neither may overwrite the other.
- Keep active records and tombstones in separate projections. The active comparison must not include tombstones; tombstones are compared against the deletion-evidence ledger.
- An export can omit deleted documents, so **a missing record is not proof of a deletion**. A record is deleted only when a Deletion Evidence Record in section 5.6 matches its `_id`, tenant, and pre-delete digest. Absence without that evidence is an unexplained export gap and blocks cutover.
- Preserve and verify both the pre-delete content digest and the tombstone digest. A tombstone that does not match the baseline record is a failure, not a deletion.

### 5.3 Rehearsal sequence

1. **Disposable dataset.** Build a representative dataset containing every retained type, drafts and published pairs, references, assets, unicode, large documents, cross-tenant traps, and deletion cases. Never use production data for a first run.
2. **Transform, reconcile, and import.** Extract, canonicalize, build the deletion-evidence ledger, import active records and tombstones into a disposable native instance, and export both native projections. Reconcile the baseline and current export as described in section 5.6 before comparing records.
3. **Compare active records.** Run:

   ```sh
   npm run native:rehearse -- compare --source source-parity.jsonl --target native-export.jsonl
   ```

   A pass requires zero missing, zero extra, zero changed, equal counts, and equal overall digest. Then compare `deletions.jsonl` to `native-tombstones.jsonl` by ID, tenant, pre-delete digest, and tombstone digest; require the section 5.6 counts and zero mismatches.
4. **Snapshot and verify.** Create a snapshot from the source active projection, verify it, and restore it to a scratch file. Take the tombstone snapshot separately and verify its IDs, counts, and digests:

   ```sh
   npm run native:rehearse -- snapshot --source source-parity.jsonl --out rehearsal/snapshot
   npm run native:rehearse -- verify --snapshot rehearsal/snapshot
   npm run native:rehearse -- restore --snapshot rehearsal/snapshot --target restored.jsonl
   ```

   `restore` writes and re-verifies JSONL; it does not restore Sanity or a deployed database.
5. **Fault injection.** Prove the harness can fail: change one record, add one, remove one, duplicate an `_id`, empty the file, malformed JSON, and tamper with a snapshot. Each case must exit non-zero and must not print a pass.
6. **Production clone.** Take a read-only export of the production dataset with `SANITY_READ_TOKEN`; import into staging native; compare; run the full route, tenant, P-118, and P-121 suites. No production writes.
7. **Assets.** Run the section 5.5 export/import/verify gate for both the disposable and production-clone rehearsals. A content-only pass is not a rehearsal pass.
8. **Final delta.** On cutover day, freeze Sanity writes, export the final content, asset, and deletion delta, import it, reconcile tombstones, compare again, snapshot, and only then switch authority.

### 5.4 What this proves and what it does not

It proves export-to-export parity, snapshot integrity, JSONL restore mechanics, and that the harness detects divergence and corruption. It does **not** prove Sanity extraction correctness, asset completeness, deletion evidence, tenant refusals, a deployed restart/restore, a reverse import, or owner sign-off. Those are separate acceptance items and must be recorded separately; section 5.5 supplies the asset gate, section 5.6 supplies the deletion gate, and section 6 supplies the rollback proof.

### 5.5 Asset export/import/verify gate

Assets are a separate data plane from JSONL content. A content comparison can pass while images, files, and references are broken, so no cutover is authorized until this gate passes. Shared-versus-copy ownership, storage keys, deletion, and delivery are governed by the [native CMS asset tenancy and sharing policy](native-cms-asset-tenancy-sharing-policy.md).

**Export gate**

- Enumerate every `sanity.imageAsset` and `sanity.fileAsset`, plus every asset `_ref` in retained content. Record counts by type, status, and tenant.
- Download each binary with a read-only token and store it byte-for-byte. Do not treat a Sanity CDN URL as the native source.
- Compute SHA-256 for every binary and an overall manifest digest. Preserve `_id`, `_type`, MIME type, byte size, original filename, dimensions, metadata, `_createdAt`, `_updatedAt`, and `_rev`.
- Fail the export if any referenced asset has no document, any document has no binary, any hash cannot be computed, or any asset ID is duplicated.

**Import gate**

- Store every binary under a deterministic native key and preserve its metadata and SHA-256.
- Rewrite every content asset reference to the native asset ID. No native record may retain a `_ref` to a Sanity asset document.
- Ensure served HTML, API responses, and image URLs use native storage, never `cdn.sanity.io` or a project-scoped Sanity URL.
- Fail the import if any reference is unresolved, any binary fails re-hash, or any asset is silently dropped.

**Verify gate**

- Re-hash every imported binary and compare it to the manifest. Compare source and native totals within each status set (`active`, `tombstoned`, `purged`, `archived`): asset count, total bytes, per-asset SHA-256, MIME type, and filename.
- Require **0 missing, 0 extra, 0 duplicate, 0 unresolved references, and 0 hash mismatches** in the active set. Tombstoned assets must match the deletion ledger by ID and digest; purged assets retain metadata and digest but no binary. Orphan source assets remain in the full manifest and may be marked `archived` only with a written owner decision; they are never silently dropped.
- Export the native assets back to the reverse-migration format and verify the round trip. A JSONL content pass does not satisfy this gate.

**Acceptance:** the evidence package records source and native asset counts by status, total bytes, manifest digest, every reference count, and the verify result. Any active asset missing, tombstoned asset mismatch, unresolved reference, hash mismatch, or Sanity-hosted asset URL is a failed cutover.

### 5.6 Deletion, tombstone, and audit gate

Deletion is an event with evidence, not an absence from an export. This gate applies to every content type and to assets.

**Reconciliation states**

| State | Definition | Cutover result |
|---|---|---|
| `active` | Present in the current export and native active projection; digests match. | Pass. |
| `deleted` | Absent from the current export, present in the verified baseline, matched by a Deletion Evidence Record, and the latest tombstone state is `deleted` (not `restored`). | Pass only if the native tombstone exists, its latest state is `deleted`, and both the pre-delete and tombstone digests match. |
| `created_then_deleted` | Created after the baseline and deleted before the final export, so it appears in neither snapshot; both creation and deletion evidence exist and the latest tombstone state is `deleted`. | Pass only if the creation evidence, pre-delete digest, tombstone, and latest `deleted` state match. |
| `unexplained_missing` | Absent from the current export with no matching deletion evidence. | **Fail.** This is an export gap or an unrecorded deletion, not a deletion. |
| `unexpected_deletion` | Deletion evidence exists for an active record with no tombstone, or for an ID outside the baseline and created-then-deleted sets. | **Fail.** Reconcile before cutover. |
| `restored_missing` | The latest tombstone state is `restored`, but the record is absent from the final export. | **Fail.** It cannot pass as `deleted` or `created_then_deleted`; a later audited deletion is required. |
| `restore_audit_mismatch` | A `restored` tombstone lacks matching `content.restore.requested` and `content.restored` audit events, or its tenant, document, prior deletion, actors, approval, timestamps, or digest does not match. | **Fail.** The restore state is not proven. |
| `resurrected` | A record is present while the latest tombstone state for the same ID and tenant is still `deleted`. | **Fail.** Restore must be explicit, audited, and recorded as a `restored` tombstone state; a `restored` state is allowed only when the record is present with a matching active digest and its restore audit verifies. |
| `tombstone_mismatch` | The tombstone's pre-delete digest or tombstone digest does not match the baseline (or the creation digest for a created-then-deleted record). | **Fail.** The tombstone does not prove which content was deleted. |
| `scope_excluded` | The record is absent because the export scope, type list, filter, or permission changed. | **Fail the comparison.** Re-export with the declared scope; a scope change is not a deletion. |

**Deletion Evidence Record**

Every claimed deletion needs one immutable record with:

| Field | Requirement |
|---|---|
| `deletionId` | Unique, non-empty, stable across rehearse/import/verify. |
| `documentId` | The Sanity `_id`, including the `drafts.` prefix where applicable. |
| `documentType` | The `_type` and whether it was published or a draft. |
| `tenantId` | The tenant that owned the record. |
| `deletedAt` | Source timestamp with timezone; not the import time. |
| `deletedBy` | Actor if the source exposes one; `unknown` is allowed only with a named operator confirmation and is flagged. |
| `source` | `sanity-history`, `operator-confirmed`, or `retention-policy`. An inference from absence is **not** a source. |
| `preDeleteRev` | Last known Sanity `_rev`, if available. |
| `preDeleteDigest` | SHA-256 of the canonical pre-delete record, using the same projection as the active comparison. |
| `tombstoneDigest` | SHA-256 over `documentId`, tenant, pre-delete digest, deletion time, actor, reason, and source. |
| `reason` | Human-readable reason; retention-policy deletions name the policy. |
| `evidenceRef` | Path or identifier of the source evidence retained with the rehearsal package. |
| `recordedAt`, `recordedBy` | When and by whom the evidence record was captured. |

**How a Sanity deletion is distinguished from a missing export record**

1. Establish a verified baseline snapshot with a declared scope. Deletions before that baseline are out of scope and recorded as pre-baseline; they do not need tombstones.
2. Export the current dataset and build `scope.json`. A change in project, dataset, type list, draft policy, filter, or token scope invalidates the comparison; it is not evidence of deletion.
3. Compute `missing = baseline IDs - current IDs`, `expected = deletion-evidence IDs with deletedAt on or after the baseline export time`, `createdAfterBaseline = creation-evidence IDs`, `deletedTombstoneIDs = IDs whose latest tombstone state is deleted`, `createdThenDeleted = (createdAfterBaseline ∩ expected ∩ deletedTombstoneIDs) - current IDs`, and `restored = IDs whose latest tombstone state is restored and which are present in the current export with a matching active digest`. Deletion evidence from before the baseline is recorded but excluded from reconciliation.
4. A missing baseline record is `deleted` only when it has a matching Deletion Evidence Record whose `preDeleteDigest` equals the baseline digest, whose tenant matches, and whose ID is in `deletedTombstoneIDs`. If the latest tombstone state is `restored`, it cannot be classified as `deleted`; an absent record is `restored_missing` and cutover blocks.
5. A record in `createdThenDeleted` is `created_then_deleted` only when both a creation-evidence record and a deletion-evidence record exist, its `preDeleteDigest` equals the creation digest, and its ID is in `deletedTombstoneIDs`. A latest `restored` state cannot qualify; if the record is absent, it is `restored_missing` and cutover blocks. Without both evidence records, it is an unexplained gap.
6. If `missing - expected` is non-empty, those records are **unexplained missing** and cutover blocks. Do not synthesize a tombstone from absence.
7. If `(createdAfterBaseline - current IDs - expected)` is non-empty, those are **unexplained post-baseline creation/deletion gaps** and cutover blocks.
8. If `expected - missing - createdThenDeleted - restored` is non-empty, those are **unexpected deletions** and cutover blocks.
9. If `expected` intersects the current export and the latest tombstone state is still `deleted`, those records are **resurrected** and cutover blocks. A `restored` state is allowed only when the record is present with a matching active digest and its restore audit verifies.
10. A record whose latest tombstone state is `restored` but which is absent from the final export is `restored_missing` and cutover blocks. It cannot be accepted as `deleted` or `created_then_deleted`; only a later audited `deleted` event makes it eligible again.
11. For every `restored` tombstone, verify the matching `content.restore.requested` and `content.restored` audit events: same tenant and document, a preceding `content.delete.applied` event, request and restore timestamps and actors, approval reference, and tombstone digest. A missing, duplicate, out-of-order, or mismatched restore audit is `restore_audit_mismatch` and cutover blocks. A present restored record is not a valid restore without this audit evidence.
12. New records since baseline are allowed only as classified creates with a creation record; an unexplained extra record is a comparison failure.

Sanity history or mutation audit is the preferred deletion source. If the project cannot expose enough history, a pre-delete snapshot plus a signed operator confirmation is acceptable, but it must name the operator, the time, the reason, and the evidence reference. A pre/post export diff can identify candidates; it cannot by itself prove a deletion.

For post-baseline creates, retain a creation-evidence record with the ID, type, tenant, `createdAt`, initial digest, and source. A creation followed by deletion is valid only when both records exist and the deletion's pre-delete digest matches the creation digest; otherwise it is an unexplained creation/deletion gap.

**Native tombstone and soft-delete semantics**

- A tombstone is a first-class, append-only record containing the document ID, `_type`, tenant, `deletedAt`, `deletedBy`, `deletionReason`, `deletionSource`, `preDeleteRev`, `preDeleteDigest`, `tombstoneDigest`, and state `deleted`. An authorized restore appends a `restored` state event and reactivates the original ID; the tombstone remains for audit and no longer suppresses the record.
- Normal reads, lists, searches, context retrieval, and agent queries exclude tombstoned records by default. A soft-deleted normal read returns 404; a purged normal read returns 410; an audit-scoped read returns the tombstone explicitly. Never return 500 or a partially deleted object.
- A write or relation to a tombstoned record fails closed. References remain inspectable as deleted references but never resolve to active content; the reference-integrity check must report zero dangling active references.
- Deleting a record with active inbound references is refused unless the Product Owner-approved reference policy says those references become deleted. The refusal names the referencing records; retarget or soft-delete them first, then rerun the integrity check.
- Repeating a delete returns the existing tombstone (idempotent). Creating a new record with the same ID is refused with 409 unless it is an explicit restore. Restore preserves the original ID, requires an authorized human, emits `content.restored`, and appends the `restored` tombstone state so the record is no longer classified as resurrected.
- Deletion and restore are human content-administrator actions. Agents cannot delete content. A retention-driven purge runs only under a declared policy and must be audited; legal hold blocks purge.
- Required audit events are `content.delete.requested`, `content.delete.applied`, `content.restore.requested`, `content.restored`, `content.purge.requested`, and `content.purged`. Each records tenant, actor, time, reason, document ID, before/after digests, correlation ID, and approval ID where applicable. If the audit write fails, the delete/restore/purge fails.
- Initial cutover uses soft delete only. Hard purge is not required to demote Sanity and is a separate, owner-approved operation. If enabled, purge removes the payload but retains the tombstone, digest, and audit record; it must not resurrect content through backup restore.
- Decisions, approvals, authorization audits, and execution audits are append-only and may not be hard-deleted. A retention action against them is metadata-only and requires the same audit evidence.

**Migration, assets, and reverse migration**

- Import active records and tombstones as separate projections. Do not include tombstones in the active-record parity file; compare them against `deletions.jsonl` and `native-tombstones.jsonl`.
- Assets use the same evidence ledger. A soft-deleted asset keeps its binary and metadata until purge; active content may not resolve a tombstoned asset. Asset manifests use `active`, `tombstoned`, `purged`, or `archived` status.
- Reverse migration maps native tombstones to audited Sanity deletions and must not recreate them as active documents. Test the reverse deletion path on the disposable dataset before using it in R2.
- Backup and restore include tombstones and audit records. Restoring a pre-deletion backup must not make a later tombstoned record active again; replay the tombstone/audit state and verify it.
- Snapshot and restore the tombstone ledger separately from active records; verify IDs, counts, and digests after restore. A JSONL-only active-record restore is not a tombstone restore.

**Fault injection and acceptance**

Prove the gate fails on: a record removed without deletion evidence; deletion evidence with no missing record; a present record with an unresolved `deleted` tombstone; a restored record missing from the final export; a restored tombstone without matching `content.restore.requested`/`content.restored` audits or with mismatched restore actors, approval, timestamps, or digest; an altered pre-delete digest; a duplicate tombstone; a cross-tenant tombstone; a delete with active inbound references; an agent attempting delete; an unauthorized restore; a legal-hold purge; a tombstoned asset served as active; a purged asset binary reappearing; and a tampered deletion audit event. Separately prove the allowed paths: an authorized delete followed by restore produces one active record with an audited `restored` tombstone state, and a repeated delete returns the existing tombstone.

The gate passes only with **0 unexplained missing, 0 unexpected deletions, 0 restored-missing records, 0 restore-audit mismatches, 0 resurrected IDs, and 0 tombstone digest mismatches**, every deletion backed by evidence and a latest `deleted` tombstone state, a verified audit chain that rejects tampering, successful delete/restore/purge-policy tests, a verified reverse deletion, and a tombstone snapshot/restore that preserves IDs, counts, and digests without resurrecting content.

## 6. Rollback

Rollback is a phase-specific procedure, not a single command.

### Rollback authority and recovery objectives

**Rollback Authority:** the Product Owner (Nuera RDL). Only this authority may declare R2/R3, unfreeze Sanity, accept an RPO breach, or authorize a data-loss incident. The cutover record names the individual and a backup; if neither is available, the cutover is paused. The Technical Rollback Lead executes and verifies commands but cannot authorize rollback or accept data loss.

| Phase | RPO | RTO | Method |
|---|---:|---:|---|
| R0 — before write cutoff | 0 | 15 minutes | Abort; unfreeze Sanity |
| R1 — read shadow | 0 | 15 minutes | Switch reads back to Sanity |
| R2 — after native writes, within 14 days | 0 committed native writes | 4 hours | Export native delta, reverse-import, compare, unfreeze |
| R3 — after demotion | 15 minutes | 4 hours | Restore native from PITR or 15-minute backups |

RTO is measured from the Rollback Authority's declaration to verified service restoration, including data comparison. R2's RPO 0 requires the reverse path to preserve every committed native write; if it cannot, R2 is not authorized and the only remaining option is an emergency Sanity snapshot restore declared as a data-loss incident. R3 requires a backup cadence that actually supports 15 minutes; if the cadence is weaker, the recorded RPO is the last verified backup, not 15 minutes. After the 14-day R2 window, recovery is restore-forward from native backups (R3); reopening Sanity requires a new cutover plan.

### R0 — Before the write cutoff

Sanity is still authoritative. Abort the cutover, unfreeze Sanity writes, discard the native copy, and record the abort. Target: RPO 0, RTO 15 minutes.

### R1 — During read shadow

Native is read-only. Switch reads back to Sanity. Target: RPO 0, RTO 15 minutes. This is the cheapest failure mode and should be exercised first.

### R2 — After native has accepted writes

Target: RPO 0 for every committed native write, RTO 4 hours. Do not simply point reads back at Sanity: Sanity is now stale. The tested sequence is:

1. Stop native writes.
2. Export the native delta in the reverse projection, including the asset manifest and tombstone ledger.
3. Reverse-map to Sanity document shape, preserving IDs, drafts, references, tenant fields, audit records, and asset references; map native tombstones to audited Sanity deletions and a reverse deletion ledger.
4. Import into Sanity on a disposable dataset first, then the production dataset under the approved change window.
5. Compare native source to restored Sanity target; require zero missing, extra, or changed records and zero asset mismatches. Compare the reverse deletion ledger to the native tombstones by ID, tenant, and digest; require zero deletion-evidence or tombstone mismatches. Sanity will not contain tombstone documents, so the reverse ledger is the comparison source.
6. Unfreeze Sanity only after the comparison passes and the Rollback Authority signs the result.

If the reverse import fails, restore the pre-cutover Sanity snapshot and accept only the explicitly approved RPO loss; this requires the Rollback Authority's approval and an incident record. Never run dual writes as a fallback.

### R3 — After demotion

Sanity may be read-only and stale. Target: RPO 15 minutes, RTO 4 hours. Restore from native PITR or 15-minute backups, including the asset bundle and tombstones; do not reopen Sanity writes without a new cutover plan and a fresh parity rehearsal.

### Retention and drills

- Retain the pre-cutover Sanity snapshot, asset bundle, and native PITR/15-minute backups for at least 30 days after demotion.
- Run R0/R1 drills on staging before cutover and record the measured time against the 15-minute RTO.
- Run an R2 reverse-migration drill on the disposable dataset, including assets; record the exact time to restore and compare against the 4-hour RTO.
- Run an R3 native backup/restore drill and record the measured RPO/RTO.
- Do not authorize C6 until R0–R2 drills pass and the Rollback Authority signs the measured RPO/RTO.

## 7. Exact conditions before Sanity is demoted to optional

All of the following must be true in the same reviewed evidence package:

1. **Sanity-specific gate.** All 14 core content rows are `native`, each with registered test evidence and the negative cases in section 4. No content row is `partial` or `absent`; `content.credential-free-startup` is marked native last.
2. **Gate.** [ADR 0006](adr-0006-content-parity-first-gate.md) supersedes ADR 0005 and scopes the Sanity demotion to content parity: `npm run native:parity:gate` must exit 0 with all 14 content rows native. The global gate (`npm run native:gate`, 23 rows) still governs the product-level claim that no third-party account is required, and still blocks OIDC, Resend and hosted-model retirement. A matrix status edit alone is not sufficient, and neither gate may pass over an empty scope.
3. **Credential-free proof.** A clean install with every `SANITY_*`, `NEXT_PUBLIC_SANITY_*`, and external-Strapi variable absent runs the console, core content flows, admin, seed, and API. `npm run verify`, the web build, and `npm run check:clean-install` pass without a CMS account.
4. **Data parity.** A real production export and native import must satisfy all of the following:
   - **Content:** zero missing, extra, or changed active records; counts and overall digest match; drafts, references, and audit records are accounted for.
   - **Assets:** the section 5.5 gate passes with 0 missing, 0 extra, 0 duplicate, 0 unresolved references, and 0 SHA-256 mismatches in the active set; tombstoned and purged assets match the ledger; no Sanity-hosted asset URLs; reverse round trip verifies.
   - **Deletion:** the section 5.6 gate passes with 0 unexplained missing, 0 unexpected deletions, 0 restored-missing records, 0 restore-audit mismatches, 0 resurrected IDs, and 0 tombstone digest mismatches; every deletion has evidence and a latest `deleted` state; every `restored` state has matching `content.restore.requested` and `content.restored` audit events; tombstones and audit chains survive restore.
   - The active and tombstone snapshots verify, and their restores re-verify the written data.
5. **Reverse path and recovery.** A native-to-Sanity reverse migration passes on the disposable dataset with zero divergence in active records, assets, and the reverse deletion ledger. R2 is recorded at **RPO 0 committed native writes and RTO 4 hours**; R3 at **RPO 15 minutes and RTO 4 hours**; the Rollback Authority signs both. A JSONL-only restore is not a Sanity rollback proof.
6. **Contract and isolation.** P-118 validates all 51 operations against native seeded data; every route has auth and tenant-refusal coverage; soft-deleted reads return 404 and purged reads return 410; two-tenant isolation passes for collections, relations, queries, admin, context, and tombstones; P-121 passes on the native path.
7. **Operational evidence.** At least 7 consecutive days of read shadow and 14 consecutive days of real native writes, with zero unresolved divergence and no open Sev-1/Sev-2 data-integrity incident. If no real use occurs, the condition is not met.
8. **Backup and audit.** A backup/restore drill preserves decisions, approvals, authorization/execution audits, tombstones, and hash chains; the native backup cadence supports the R3 target; retention and disaster recovery are documented; a failed audit write still aborts the mutation.
9. **Adapter and governance.** The Sanity adapter is read-only by default, write-back is disabled, no required build/CI/runtime path imports Sanity, and the optional adapter's read path is tested. `native-capabilities.json` is version-bumped, `providers[].sanity.status` is `optional`, the R1 disposition is updated, a dated evidence record is linked, and the Rollback Authority signs off. Demotion lands after the replacement proof, not in the replacement PR.
10. **Retention.** The Sanity dataset, assets, and read-only credentials remain available for at least 30 days after demotion. Deleting the dataset or revoking credentials is a separate decommission decision with its own backup and rollback plan.

Until all ten conditions are met, Sanity stays `required`, the gate stays blocked, and the native backend remains a migration target rather than the default.

## 8. Open decisions for the owner

- Which of the 36 Sanity types are retained, derived, or retired; each retirement needs a named owner and migration note. See the [C0 inventory](native-cms-c0-inventory.md); `playbook` is the only proposed retirement and is not approved.
- Whether Strapi remains the implementation chassis after cutover or the native repositories run without it.
- Native admin scope and editor workflow parity checklist.
- Asset/object-store choice and media lifecycle.
- Tombstone retention period and the owner-approved hard-purge policy; initial cutover uses soft delete only.
- How the 15-minute R3 RPO is achieved (PITR versus 15-minute snapshots) and the named backup operator.
- Whether a future ADR narrows the global gate to provider-scoped blockers. [ADR 0005 (Proposed)](adr-0005-sanity-demotion-global-gate.md) preserves the global gate; any narrowing requires a superseding ADR and an explicit change to ADR 0003 L2.
