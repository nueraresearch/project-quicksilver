# C0 asset and deletion baseline procedure (draft)

- **Status:** Draft procedure for owner/security review — no production export has been run under it.
- **Date:** 2026-11-17
- **Scope:** The C0 baseline required by [native CMS cutover](native-cms-cutover.md#c0--baseline-inventory-and-scope-freeze): a read-only content export, a byte-for-byte asset baseline, deletion evidence, and verified manifests. The reconciliation rules come from sections 5.5 and 5.6 and [ADR 0004](adr-0004-native-cms-deletion-tombstones.md). The native-side tenancy, sharing, key, and delivery rules are in the [asset tenancy and sharing policy](native-cms-asset-tenancy-sharing-policy.md).
- **Non-goals:** This procedure does not import into the native CMS, create native tombstones, run a C5 rehearsal, prove tenant isolation, restore a deployed system, or authorize a cutover. C0 is read-only.
- **Hard rule:** Absence from an export is not a deletion. A missing record becomes a deletion only when matching deletion evidence proves it, and a native tombstone agrees at C5.

## 1. Roles and authorization

| Role | Responsibility |
|---|---|
| **Product Owner** (Nuera RDL) | Approves the baseline scope, the use of the Viewer token, and the redacted evidence record. Owns the scope freeze. |
| **Technical baseline lead** | Runs the export, canonicalization, hashing, and reconciliation; records commands and digests. |
| **Security reviewer** | Confirms the token is a dedicated Viewer token, the private store is access-controlled, and no secret or private payload enters the repository. |
| **Content owner** | Supplies or confirms deletion evidence that Sanity history cannot prove. A confirmation must name the document IDs, tenant, time, reason, and pre-delete digest. |

Only the Product Owner may approve a baseline with unexplained missing records, an incomplete asset set, or an unverified deletion. The default is to block, not to accept an inference.

## 2. Read-only guarantees

The baseline is invalid if any of these are false:

1. The only credential in the process is a Sanity **Viewer** token. Do not use the Editor `SANITY_WRITE_TOKEN`, the legacy combined `SANITY_AUTH_TOKEN`, a Studio login with edit rights, or a token scoped to another project.
2. The export commands perform reads only. No `documents create/replace/delete`, `datasets import`, `mutations`, `seed`, `reset`, Studio publish, or web write route runs during the baseline. Do not run `sanity login` for this baseline; use the Viewer token assigned to the project, with `--project-id` and a clean CLI config, so a logged-in Editor session cannot silently become the exporter's authority.
3. `SANITY_WRITE_TOKEN` is absent from the process environment. Record environment variable **names** only; never print values.
4. The Viewer token is loaded from the approved secret store. Record its SHA-256 fingerprint and the secret-store reference in `scope.private.json`; never record the token itself.
5. The private baseline directory is outside the Git worktree, mode `0700`, on an encrypted and access-controlled volume. Do not use a synced consumer folder.
6. Git receives only the redacted evidence described in §7. Raw documents, binaries, full IDs, tenant IDs, URLs, filenames, history transactions, and tokens stay private.

`npx sanity datasets export` defaults to strict asset verification. **Do not pass `--no-strict-asset-verification` or `--no-assets` for a baseline.** The export help states that assets returning 401, 403, or 404 are excluded; any excluded asset is a baseline failure, not permission to continue. `--raw` is used only for the document pass because it preserves source asset references; the full asset pass must still verify binaries. The CLI reads `SANITY_AUTH_TOKEN`; the commands set that variable to the Viewer token for the process only. Never set it to the combined legacy token or an Editor token.

## 3. Declare the baseline scope

Create one private directory and one redacted public record:

```text
$QS_BASELINE_DIR/                 # outside the repository, mode 0700
  private/
    scope.json
    content/source-raw.tar.gz
    content/source-raw.jsonl
    content/source-parity.jsonl
    content/export-with-assets.tar.gz
    assets/                     # byte-for-byte binaries
    asset-documents.json
    assets-manifest.json        # full, private
    assets.sha256
    history/transactions.ndjson
    history/deletions.jsonl     # evidence ledger
    history/deletions.pre-baseline.jsonl
    history/creations.jsonl
    tombstones.expected.jsonl   # C5 import candidates, not native records
    snapshot/                   # native:rehearse content snapshot
  public/
    evidence.md
    scope.public.json
    content-summary.json
    assets-summary.json
    deletions-summary.json
    digests.json
```

`scope.json` is the frozen definition. It records:

| Field | Rule |
|---|---|
| `baselineId` | New random UUID v4; never reuse a failed baseline; never encode a tenant, dataset, date, or slug. |
| `projectId`, `dataset` | Exact source; changing either invalidates the baseline. |
| `apiVersion` | The Sanity API version used by every export and history request. |
| `exportStartedAt`, `exportCompletedAt` | UTC timestamps; the baseline window is `[start, end]`. |
| `scopeTypes` | The retained C0 type list, plus `sanity.imageAsset` and `sanity.fileAsset`. OIDC transaction/session types are excluded. `playbook` is included only if the owner has decided to retain it. |
| `draftPolicy` | `include` — published and `drafts.*` records are distinct and both retained. |
| `assetPolicy` | `all-referenced-and-orphan-documents`; binaries included; no exclusion by 401/403/404. |
| `historyWindow` | Sanity History retention available for the project and the queried time range. |
| `tokenAccess` | `viewer`; token fingerprint and secret-store reference, never the value. |
| `toolVersions` | Sanity CLI and Node versions. |
| `commandLog` | Redacted command shapes, not tokens. |

Compute `scopeDigest` as SHA-256 over the canonical `scope.json` (recursively sorted keys, arrays preserved). Record it in both the private and public records.

### 3.1 Scope freeze

C0 must not write to Sanity. Before the export, the Product Owner declares a freeze window covering both export passes and the deletion-history query. Confirm no write job, Studio editor, seed, reset, migration, or agent is running.

If any Sanity write occurs during the window, the baseline is **not** a baseline: discard the artifacts, create a new `baselineId`, and rerun. Do not splice two exports or claim the later timestamp repairs a concurrent write.

If a write freeze cannot be obtained, stop. A read-only export with concurrent mutations is a moving target, not a C0 baseline.

## 4. Content export

### 4.1 Document pass with source references

Use the raw export for documents. It preserves source `_ref` values, which are needed to prove asset-reference closure. Require the Viewer token to be present before constructing the process environment; never let an unset variable silently become an empty token:

```sh
: "${SANITY_READ_TOKEN:?a Viewer token is required from the approved secret store}"
env -u SANITY_WRITE_TOKEN -u SANITY_AUTH_TOKEN \
  SANITY_AUTH_TOKEN="$SANITY_READ_TOKEN" \
  npx sanity datasets export "$DATASET" "$QS_BASELINE_DIR/private/content/source-raw.tar.gz" \
  --project-id "$PROJECT_ID" \
  --types "$RETAINED_TYPES" \
  --raw \
  --overwrite
```

The actual `RETAINED_TYPES` list is the C0-retained set, not Sanity’s entire schema. Record the exact list in `scope.json`. Do not use `--no-assets` here: it removes image references and destroys the closure check. Do not use `--no-drafts`: drafts and published documents are separate records.

Extract the tarball into the private directory using its own manifest. Convert its document stream to `source-raw.jsonl` without editing fields. If the CLI writes a mapping file for asset references, retain it as private evidence; do not treat a rewritten local path as the source asset `_ref`.

### 4.2 Content integrity

1. Require one JSON object per line with non-empty `_id`; preserve `_type`, `_rev`, `_createdAt`, `_updatedAt`, `tenantId`/`companyId` if present, drafts, references, unknown fields, and array order.
2. Reject empty files, malformed JSON, duplicate `_id`, or a missing `_type`.
3. Build `source-parity.jsonl` through the versioned canonical projection used by the rehearsal harness: recursively sort object keys, preserve arrays, and exclude only fields the native store legitimately regenerates. Exclusions must be in both the source and native projections. Never exclude a business, authority, audit, tenant, or reference field to make parity pass.
4. Snapshot and verify the raw and parity files with the existing harness:

```sh
npm run native:rehearse -- snapshot --source "$QS_BASELINE_DIR/private/content/source-raw.jsonl" \
  --out "$QS_BASELINE_DIR/private/snapshot/raw"
npm run native:rehearse -- verify --snapshot "$QS_BASELINE_DIR/private/snapshot/raw"
npm run native:rehearse -- snapshot --source "$QS_BASELINE_DIR/private/content/source-parity.jsonl" \
  --out "$QS_BASELINE_DIR/private/snapshot/parity"
npm run native:rehearse -- verify --snapshot "$QS_BASELINE_DIR/private/snapshot/parity"
```

The harness exits **2** for malformed or empty input, **1** for divergence or corruption, and **0** only for a verified snapshot. Preserve all three outcomes; do not convert a non-zero exit into a warning.

5. Record in `content-summary.json`: document count, counts by `_type`, counts by draft/published status, overall parity digest, snapshot manifest digest, and rejected/excluded counts with reasons. Do not put document IDs or content in the public file.

### 4.3 Asset-aware document pass

Run a second export with assets enabled to obtain binaries. Keep the raw document pass as the source of references; do not assume the asset-enabled export’s rewritten paths are canonical.

```sh
env -u SANITY_WRITE_TOKEN -u SANITY_AUTH_TOKEN \
  SANITY_AUTH_TOKEN="$SANITY_READ_TOKEN" \
  npx sanity datasets export "$DATASET" "$QS_BASELINE_DIR/private/content/export-with-assets.tar.gz" \
  --project-id "$PROJECT_ID" \
  --types "$RETAINED_TYPES,sanity.imageAsset,sanity.fileAsset" \
  --overwrite
```

If the CLI’s `--types` filter prevents complete asset-document enumeration, use a separate read-only asset query and a separate authenticated binary download. The requirement is completeness; the command shape is secondary. Record which path was used.

Never accept the export’s “asset excluded because 401/403/404” behavior as an empty asset. Enumerate the asset documents separately in §5.1 and fail on any document without a binary.

## 5. Asset baseline and hashing

### 5.1 Enumerate every asset document

Query both asset document types, including orphans. Run the §4.1 token guard first; the same Viewer-only environment applies:

```sh
: "${SANITY_READ_TOKEN:?a Viewer token is required from the approved secret store}"
env -u SANITY_WRITE_TOKEN -u SANITY_AUTH_TOKEN \
  SANITY_AUTH_TOKEN="$SANITY_READ_TOKEN" \
  npx sanity documents query \
  '*[_type in ["sanity.imageAsset","sanity.fileAsset"]]' \
  --project-id "$PROJECT_ID" --dataset "$DATASET" --api-version "$API_VERSION" \
  > "$QS_BASELINE_DIR/private/asset-documents.json"
```

Record every asset `_id`, `_type`, MIME type, byte size, original filename, dimensions, metadata, `_createdAt`, `_updatedAt`, `_rev`, `url`, and `sha256` if the source provides one. Asset documents usually do not carry a tenant. Derive the asset’s tenant association from every retained content record that references it; record all verified associations. An asset referenced by more than one tenant is flagged for an owner decision and is never silently duplicated or assigned to one tenant. An asset with no verified association is `global-or-orphan` and is not counted in a tenant total until the owner classifies it.

Do not rely on a filename to identify an asset. Sanity asset IDs are the identity; the binary filename is metadata.

### 5.2 Capture binaries

Extract binaries from the verified asset-enabled export, or download each asset document’s binary with the same Viewer token. Either method must preserve bytes exactly; do not transcode, resize, strip metadata, or follow a CDN URL as if it were the source of truth.

For each binary:

1. Match it to exactly one asset document.
2. Record its actual byte size and MIME type; compare them to the source metadata.
3. Compute SHA-256 over the bytes.
4. If the source document declares a SHA-256, compare it. A declared hash is supporting evidence, not a substitute for the independent hash.
5. Reject duplicate asset IDs, two documents pointing at one binary without a documented shared-asset case, and a binary with no document.
6. A missing binary is a failure, not `purged`, unless deletion evidence proves a purge and the owner approves that status.

```sh
(cd "$QS_BASELINE_DIR/private" \
  && find assets -type f -print0 | sort -z | xargs -0 sha256sum > assets.sha256)
(cd "$QS_BASELINE_DIR/private" && sha256sum -c assets.sha256)
```

The second command must verify every line. A single missing or changed file fails the baseline.

### 5.3 Reference closure

Parse the raw documents, not a rendered page or a rewritten export path. For each retained published or draft record:

- Collect every asset `_ref` from image/file objects and references.
- Require a matching asset document in `asset-documents.json`.
- Require the asset to be `active` for every active-record reference. A tombstoned asset may remain referenced only by a tombstoned record or an explicitly approved archived reference; it is never served as active.
- Record the reference count in both directions: asset → documents and document → assets.
- Reject unresolved references, references to an asset in another tenant, and an active record that points to a missing or purged binary.

An orphan asset is not silently deleted. It remains in the full manifest and is marked `archived` only with a written owner decision. An asset document with no binary is a failure unless it is a verified `purged` asset with deletion evidence and retained digest metadata.

### 5.4 Asset manifest

Write `assets-manifest.json` with one entry per asset and a summary. Each entry contains at least:

| Field | Requirement |
|---|---|
| `sanityAssetId` | Source `_id`; private manifest only. |
| `nativeAssetId` | `null` during C0; populated only by a later import. |
| `status` | `active`, `tombstoned`, `purged`, or `archived`; status comes from source evidence, not inference. |
| `mimeType`, `byteSize` | Measured values. |
| `sha256` | Independently computed over the binary. |
| `sourceUrl` | Private manifest only; never committed. |
| `storageKey` | Private staging key; never committed. |
| `originalFilename`, `dimensions`, `metadata` | Private metadata. |
| `referenceCount` | Number of active and tombstoned references, separated. |
| `tenantIds` | Private; empty/`unresolved` blocks tenant claims. |
| `verifyResult` | `pass`, or the exact failure. |

The manifest summary records asset count, total bytes, counts by type/status/MIME, reference counts, duplicate count, unresolved count, hash-mismatch count, and `assetsManifestDigest`.

`assetsManifestDigest` is SHA-256 over the canonical, ID-sorted list of `(sanityAssetId, status, byteSize, sha256, referenceCount, verifyResult)`. It is safe to publish; the underlying entries are not.

### 5.5 Asset verification

Run a clean re-hash against the manifest. The baseline passes only when all of these are true:

- 0 missing binaries for active/tombstoned/archived assets.
- 0 extra binaries not represented by an asset document.
- 0 duplicate asset IDs.
- 0 hash mismatches.
- 0 MIME/size mismatches that are not explicitly documented source metadata errors.
- 0 unresolved active references.
- 0 active records resolving a tombstoned or purged asset.
- Every purged asset has deletion evidence and retained digest metadata; no purged binary reappears.
- Every orphan is in the manifest and has an owner decision before `archived`.

The existing `native:rehearse` harness is content-JSONL only. **It does not verify assets.** Do not cite a content parity pass as asset evidence.

## 6. Deletion evidence and tombstone reconciliation

### 6.1 Read Sanity history, not absence

Use the History API with the Viewer token. The dataset transaction stream is read-only and supports deletion discovery. Run the §4.1 token guard first:

```sh
: "${SANITY_READ_TOKEN:?a Viewer token is required from the approved secret store}"
curl --fail --silent --show-error \
  -H "Authorization: Bearer $SANITY_READ_TOKEN" \
  "https://${PROJECT_ID}.api.sanity.io/${API_VERSION}/data/history/${DATASET}/transactions?limit=1000&reverse=true&excludeContent=true" \
  > "$QS_BASELINE_DIR/private/history/transactions.ndjson"
```

`excludeContent=true` is required; it returns transaction metadata, not document bodies. Paginate or query explicit time windows until the baseline window is covered. For each candidate ID, read the last revision before deletion:

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $SANITY_READ_TOKEN" \
  "https://${PROJECT_ID}.api.sanity.io/${API_VERSION}/data/history/${DATASET}/documents/${URL_ENCODED_DOCUMENT_ID}?lastRevision=true" \
  > "$QS_BASELINE_DIR/private/history/last-revision.json"
```

URL-encode `drafts.` IDs. Record the transaction ID, timestamp, author, affected document IDs, and mutation type. Never retain a transaction's content body in a public artifact.

History retention is finite (plan-dependent). Record the available `historyWindow`. A deletion dated before the retained history cannot be proven by Sanity history; it is either supported by a named operator confirmation or left as **pre-baseline/unknown** and excluded from the migration. Do not invent history.

### 6.2 Deletion Evidence Record

Every claimed deletion gets one immutable record in `deletions.jsonl`. Use C5’s field names; ADR 0004’s `evidenceId` is the same identifier as `deletionId`, not a second ID.

| Field | Requirement |
|---|---|
| `deletionId` | Stable UUID or deterministic hash; unique. |
| `documentId` | Exact Sanity `_id`, including `drafts.` where applicable. |
| `documentType` | `_type` and published/draft distinction. |
| `tenantId` | Owning tenant from the record or an owner-approved mapping. If the type has no tenant field, record `unresolved` and block a tenant-specific deletion claim; never infer it from `QUICKSILVER_TENANT_ID` or the exporter’s environment. |
| `deletedAt` | Source timestamp with timezone, not export/import time. |
| `deletedBy` | Source actor if exposed; otherwise `unknown` with a named operator confirmation and a flag. |
| `source` | `sanity-history`, `operator-confirmed`, or `retention-policy`. `export-diff` is not a source. |
| `preDeleteRev` | Last source `_rev` when available. |
| `preDeleteDigest` | SHA-256 of the canonical last revision, using the same projection as the content parity file. |
| `tombstoneDigest` | SHA-256 over the canonical set of document ID, tenant, pre-delete digest, deletion time, actor, reason, and source. |
| `reason` | Human-readable reason; retention policy names the policy. |
| `evidenceRef` | Private path/line or signed confirmation ID; no payload in the public record. |
| `recordedAt`, `recordedBy` | Capture time and recorder. |

The `tombstoneDigest` proves the evidence record is internally consistent. It does not prove the deletion happened; the source and `preDeleteDigest` do that.

### 6.3 Build creation evidence for post-baseline records

A record created after the baseline and deleted before the current export appears in neither export. It cannot be classified from absence. From the transaction stream, retain a `creations.jsonl` record for every post-baseline creation: ID, type, tenant, creation transaction/time, initial revision and digest, and source. A `created_then_deleted` classification requires **both** creation evidence and deletion evidence, and the deletion’s `preDeleteDigest` must equal the creation digest.

### 6.4 Reconcile the sets

Use the frozen baseline and a current, same-scope export. Compute, without using inferred deletions:

```text
baselineIds      = IDs in source-parity (baseline)
currentIds       = IDs in current parity export (same scope)
missing          = baselineIds - currentIds
eligibleEvidence = deletion evidence with deletedAt >= baseline.exportStartedAt
preBaseline      = deletion evidence dated before baseline.exportStartedAt
createdAfter     = creation evidence after baseline
tombstoned       = IDs whose latest native tombstone state is deleted
restored         = IDs whose latest native tombstone state is restored
createdThenDeleted = ((createdAfter ∩ eligibleEvidence ∩ tombstoned) - currentIds)
```

At C0 there is no native tombstone ledger. `deletions.jsonl` is the **evidence-backed expected tombstone set**; do not create native tombstones or call the C5 gate passed. `tombstones.expected.jsonl` is a private C5 import candidate: one record per eligible deletion with `deletionId`, `tenantId`, `documentId`, `documentType`, `state: "deleted"`, `deletedAt`, `deletedBy`, `deletionSource`, `preDeleteRev`, `preDeleteDigest`, and `tombstoneDigest`. It is not authoritative and must never be served as a native ledger. At C5, replace the expected set with `native-tombstones.jsonl` and require the native latest state.

| Classification | C0 baseline result | C5 result |
|---|---|---|
| `active` | Present in baseline and current; digests match. | Pass; no tombstone. |
| `deleted` | Missing, matching evidence by ID/tenant/`preDeleteDigest`; candidate only. | Pass only with native tombstone and latest state `deleted`; both digests match. |
| `created_then_deleted` | Absent from both; both creation and deletion evidence match. | Pass only with expected/native tombstone and latest `deleted`. |
| `unexplained_missing` | Missing without matching evidence. | **Fail.** |
| `unexpected_deletion` | Evidence for an active record or an ID outside the baseline/created sets. | **Fail.** |
| `restored_missing` | A latest restored state is claimed but the record is absent. | **Fail.** At C0, flag if source restore evidence is present without a record. |
| `restore_audit_mismatch` | Restore lacks matching `content.restore.requested` and `content.restored` events or fields disagree. | **Fail.** |
| `resurrected` | Record present while its latest tombstone says deleted. | **Fail.** |
| `tombstone_mismatch` | Pre-delete or tombstone digest, tenant, type, or ID disagrees. | **Fail.** |
| `scope_excluded` | Missing because project, dataset, type list, draft policy, filter, or token scope changed. | **Fail the comparison; re-export.** |

A record present in both exports with a changed digest is a content change, not a deletion. It must be reconciled as a change; never attach a tombstone to it.

### 6.5 C5 tombstone reconciliation

When the native ledger exists, `native-tombstones.jsonl` and `deletions.jsonl` are compared as separate projections:

- Match on `(tenantId, documentId)` and require the same `preDeleteDigest` and `tombstoneDigest`.
- Require exactly one latest event per ID/tenant; duplicates fail.
- Require the latest state. A latest `deleted` state may satisfy `deleted` or `created_then_deleted`; a latest `restored` state cannot.
- For every `restored` event, verify the preceding `content.delete.applied`, `content.restore.requested`, and `content.restored` events, including actors, approval, timestamps, prior deletion, tenant, and digests. A missing, duplicate, out-of-order, or mismatched event is `restore_audit_mismatch`.
- A present record with a latest `deleted` tombstone is `resurrected`; it is never served as active.
- A tombstoned asset must match the deletion ledger by asset ID and digest. A purged asset retains metadata/digest and has no binary.
- No cross-tenant tombstone, ID reuse, or agent-authored deletion is accepted.

The C5 gate passes only with **0 unexplained missing, 0 unexpected deletions, 0 restored-missing, 0 restore-audit mismatches, 0 resurrected, and 0 tombstone digest mismatches**, with every claimed deletion backed by evidence and a native latest `deleted` tombstone.

### 6.6 Pre-baseline and unknown history

Keep `deletions.pre-baseline.jsonl` as reference only. Pre-baseline evidence is not a migration deletion and does not create a native tombstone. If a missing baseline record’s only candidate evidence is older than retained history, record it as `pre_baseline/unknown`; do not classify it as deleted. A baseline record missing with no evidence is `unexplained_missing` and blocks C0.

## 7. Verified manifest record

Record ownership is resolved separately under the [C0 tenant ownership resolution and redacted manifest procedure](native-cms-c0-ownership-resolution-manifest.md). This section governs the verified content, asset, and deletion baseline record, not per-record or shared-asset ownership decisions.

### 7.1 Private manifest set

Retain in the restricted store:

- `source-raw.tar.gz`, `source-raw.jsonl`, `source-parity.jsonl`;
- every asset binary, the normalized `asset-documents.json`, and the raw asset-query output;
- full `assets-manifest.json` with IDs, URLs, storage keys, filenames, and tenant IDs;
- full `deletions.jsonl`, `creations.jsonl`, pre-baseline evidence, and history transactions;
- full `scope.json` and snapshot manifests.

Write `SHA256SUMS.private` over every private artifact and verify it before handoff. The private set is the evidence package; it is not a repository artifact.

### 7.2 Redacted public record

Publish only a redacted record, and only after the Security reviewer and Product Owner approve it. The record may contain:

| Allowed | Forbidden |
|---|---|
| Baseline ID, export window, tool versions, schema type names, counts, and status counts | Document IDs, asset IDs, tenant IDs, user/actor IDs, URLs, storage keys, filenames, dimensions, content, claims, or metadata values |
| Overall content digest, asset manifest digest, deletion-ledger digest, snapshot digest | Tokens, token fingerprints beyond an opaque secret-store reference, cookies, or credentials |
| Asset count, total bytes, MIME classes, per-status counts, reference counts | Raw binaries, base64 data, JSONL records, history transactions, or signed confirmations |
| Pass/fail results and counts of failures by category | Named individuals unless the owner explicitly approves; use role names |
| The private-store classification and artifact digest list | A path that exposes a personal or shared filesystem location |

`scope.public.json` records project/dataset only if they are already public or the owner approves; otherwise record a salted project fingerprint. `content-summary.json`, `assets-summary.json`, and `deletions-summary.json` contain aggregates only. `digests.json` records the manifest digests, not the underlying entries:

```json
{
  "format": "quicksilver-c0-baseline-evidence/v1",
  "baselineId": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "scopeDigest": "sha256:...",
  "contentParityDigest": "sha256:...",
  "contentSnapshotDigest": "sha256:...",
  "assetsManifestDigest": "sha256:...",
  "deletionLedgerDigest": "sha256:...",
  "verification": { "content": "pass", "assets": "pass", "deletion": "pass" }
}
```

This record contains no document IDs, asset IDs, tenant IDs, URLs, filenames, or payloads. The private artifact digest list is kept separately and is shared only with the C5 operator.

`evidence.md` is a narrative: baseline scope, commands in redacted form, counts, digests, verification results, exceptions, and sign-off. It must not include a raw document excerpt, an asset filename, a tenant identifier, or a token.

### 7.3 Repository rule

Do not run `git add -A` in the baseline directory. The baseline directory is outside the worktree; the only repository change is this procedure and, after approval, the redacted evidence note. If a private artifact is accidentally copied into the worktree, stop, remove it through the approved incident procedure, rotate the credential if exposed, and do not commit the file to “preserve” it.

## 8. Verification and fault injection

Before accepting a baseline, prove the procedure fails on:

**Content**

- One changed, added, or removed record.
- Duplicate `_id`, empty file, malformed JSONL, or a missing `_type`.
- A snapshot whose records no longer match its manifest digest.

**Assets**

- A referenced asset with no asset document.
- An asset document with no binary.
- A duplicate asset ID or two documents mapped to one binary without an approved shared-asset case.
- A one-byte binary change, a size mismatch, a MIME mismatch, or an unavailable hash.
- An active record referencing a tombstoned, purged, or cross-tenant asset.
- An orphan silently dropped, or an active asset URL still pointing at Sanity.
- A purged binary reappearing.

**Deletion**

- A missing record with no evidence.
- Deletion evidence with no missing record, or evidence for a different tenant/ID/digest.
- A created-then-deleted record with only one of the two evidence records.
- An altered `preDeleteDigest` or `tombstoneDigest`.
- Duplicate or cross-tenant tombstones.
- A restored record absent from the export without matching restore audits.
- A present record with a latest `deleted` tombstone.
- A changed scope, filtered export, or denied asset treated as a deletion.
- A pre-baseline deletion incorrectly counted as a migration deletion.

**Privacy**

- A token, document ID, asset ID, tenant ID, URL, filename, or content excerpt in the public record.
- A private manifest copied into the worktree.

The baseline passes only when every positive check passes and every fault-injection case exits non-zero without printing a pass. Preserve the test log privately and record the redacted result counts publicly.

## 9. C0 exit and C5 handoff

C0 asset/deletion baseline is complete only when:

- [ ] The Product Owner approved the scope and freeze; no Sanity writes occurred.
- [ ] The Viewer token was used; no write credential was present; the token is not recorded.
- [ ] `source-raw` and `source-parity` snapshots verify.
- [ ] Every asset document has a verified binary or an approved, evidence-backed status; hashes and reference closure pass.
- [ ] Every claimed deletion has a complete Deletion Evidence Record; pre-baseline and unknown cases are separated.
- [ ] Unexplained missing, unexpected deletions, duplicate tombstones, and digest mismatches are zero.
- [ ] Private manifests and `SHA256SUMS.private` verify.
- [ ] The redacted public record contains no private data and is approved.
- [ ] C5 receives the private artifact set, its digests, and the exact `baselineId`.

This baseline does **not** prove native import, native tombstones, tenant isolation, backup/restore, reverse migration, or C5 parity. Those require the C5 rehearsal and the native tombstone ledger. A content-only pass is not an asset pass, and an export diff is not deletion evidence.
