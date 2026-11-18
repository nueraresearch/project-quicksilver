# C0 tenant ownership resolution and redacted manifest procedure (draft)

- **Status:** Design-only procedure for owner and security review. The public-manifest structural gate is implemented; no production export has been run under the procedure, no ownership has been assigned by it, and no data has been imported.
- **Date:** 2026-11-17
- **Scope:** Resolving the remaining tenant-ownership gaps for every retained C0 record, alias, principal binding, and asset; producing the private ownership evidence pack and the redacted C0 ownership manifest. It applies the ownership rules in the [field mapping and tenant registry](native-cms-field-mapping-tenant-registry.md), the evidence rules in the [C0 asset and deletion baseline](native-cms-c0-asset-deletion-baseline.md), and the sharing rules in the [asset tenancy and sharing policy](native-cms-asset-tenancy-sharing-policy.md).
- **Output consumer:** The C0 exit gate and the C1 ownership gate. A signed manifest is an ownership acceptance record, not import authorization, a native migration, or a C5 parity proof.
- **Hard rule:** Every content and asset subject starts as `unresolved`; every alias starts as `pending`. A source field, a reference, a filename, a URL, an uploader, a seed fixture, a display name, a slug, a hash, or an environment variable may propose a candidate but may never confirm ownership.

## 1. Roles and separation of duties

| Role | May | May not |
|---|---|---|
| **Product Owner (Nuera RDL)** | Approve type-wide ownership rules, exceptions, shared/global asset plans, the redacted manifest, and the final C0 ownership sign-off. | Be the sole preparer of the records they approve. |
| **Tenant Authority** | The named owner or accountable role in `tenant.owner`. Attest ownership and approve aliases for that tenant. Approve that tenant's shared-asset grant. | Approve another tenant's records, approve an alias into another tenant, or approve a grant that conflicts with their own tenant's evidence. |
| **Ownership preparer** | Assemble the candidate register, collect evidence, detect conflicts, compute digests, and prepare the private and public artifacts. | Confirm ownership, approve an alias, approve a shared tenant set, or sign the manifest. |
| **Security reviewer** | Review cross-tenant conflicts, shared/global grants, redaction, evidence access, and private-artifact handling. | Decide business ownership or substitute for a Tenant Authority. |
| **Technical baseline lead** | Verify that the ownership procedure used the exact frozen baseline and that the private and public digests agree. | Sign as Product Owner or waive an unresolved record. |

A person may hold more than one role, but the collision must be recorded. One person may not be the sole preparer and sole approver of the same ownership decision. The Product Owner signature requires at least one independent reviewer attestation.

## 2. Inputs and freeze

The procedure starts only after the C0 read-only baseline exists. It uses:

- the approved C0 scope and `baselineId`;
- the private content export and its verified digest;
- the private asset manifest and binary-verification result;
- the deletion evidence set, where ownership depends on a tombstoned or restored record;
- the canonical tenant registry and `tenant_alias` register;
- the reviewed field-mapping and relation inventory;
- the approved C0 type disposition, including any owner-approved retirement.

The ownership snapshot is frozen for the duration of resolution. A new export, a changed tenant status, a new alias, a changed shared-asset decision, or a changed scope creates a new manifest version and invalidates the previous signature. Do not edit a signed manifest in place.

Seed, demo, test, and synthetic fixtures may exercise the procedure, but they cannot establish production ownership. A production tenant count is not evidence for an individual record.

## 3. Build the private candidate register

Create one private register row per retained source record and one per asset. Aggregate counts are not a substitute for per-record resolution. A type-wide rule may generate candidate rows, but every row must still be evaluated against the rule's exact predicate.

| Field | Rule |
|---|---|
| `subjectType` | `content`, `asset`, `alias`, or `principal`. |
| `sourceType` | The source schema type for content; the asset class for assets. |
| `subjectRef` | Full source ID or private asset reference. Private only. |
| `candidateTenant` | The proposed tenant, or empty. |
| `basis` | The evidence class from §4, not a free-form guess. |
| `status` | `unresolved` on creation for content and assets; `pending` for aliases. Move only through the states in §8. |
| `confidence` | `none`, `candidate`, or `confirmed`; it never overrides `status`. |
| `evidenceRefs` | Private evidence IDs or paths. |
| `conflicts` | Exact conflict codes and the conflicting subjects. |
| `decisionRef` | The owner decision that changed the status, if any. |
| `approvedBy`, `approvedAt` | Required for `confirmed` and `retired`, never populated by the preparer alone. |

The private register may contain full IDs and tenant IDs. It stays outside the Git worktree, in an access-controlled private store, and is never copied into the repository.

## 4. Evidence classes and what they can prove

| Evidence class | Can prove | Cannot prove |
|---|---|---|
| **Validated source tenant field** | The source record names an existing tenant, the value is unchanged, and no other evidence contradicts it. | That the value is correct when it conflicts with an approved alias or owner decision. |
| **Approved tenant alias** | A legacy identifier maps to exactly one tenant under an approved alias decision. | Record ownership by itself; the record still needs its own confirmation. |
| **Approved record mapping** | A named owner confirmed this record's tenant with a recorded basis. | A different record or a type-wide default. |
| **Approved type-wide rule** | A bounded predicate and record set were approved for a declared source type, fixture, or single-tenant dataset. | Any record outside the exact predicate, or a record whose evidence contradicts the rule. |
| **Reference closure** | A candidate is consistent with same-tenant references. | Authority. It produces `candidate`, never `confirmed`. |
| **Owner attestation** | A Tenant Authority or Product Owner confirms a specific record or bounded set with evidence. | A tenant that does not exist in the registry. |
| **Asset reference set** | Which confirmed content records reference an asset, and therefore which tenants have a verified association. | A shared grant, a global grant, or ownership of the content record itself. |

Evidence must be reproducible, dated, and attributable. An evidence record contains an opaque `evidenceId`, its type, the claim, the private source reference, the capture method, the captured result, the conflicts found, and the redaction class. An owner attestation additionally records the exact tenant, the subject set or its digest, the basis, the exceptions, the evidence references, the attester, the signature, and the signed time. A screenshot of an email is not a substitute for a signed attestation; the attestation must name the scope, basis, exceptions, and decision.

Absence is not evidence. “No tenant field,” “only one tenant appears in this export,” “the uploader is an admin,” and “the reference is the only one” all leave the subject `unresolved` or `candidate`.

## 5. Resolution order and conflict rules

Resolve each subject in this order, but stop at the first contradiction:

1. **Validated explicit tenant.** The tenant must exist in the registry and the value must be exact. Unknown, closed-without-decision, or case-varied values block.
2. **Approved alias.** The alias must be `approved` and map to exactly one tenant. Preserve the legacy value; never write it into `tenantId`.
3. **Approved record mapping or bounded type-wide rule.** The predicate, record set, owner, and evidence must all match.
4. **Owner attestation.** A specific, signed confirmation for the record or bounded set.
5. **Reference-closure candidate.** Record `candidate`; it becomes `confirmed` only after an owner decision. Agreement among references is supporting evidence, not authority.
6. **No fallback.** `QUICKSILVER_TENANT_ID`, a process environment, an empty value, a slug, a display name, an email address, a filename, an uploader, a hash, or a default tenant never assigns ownership.

The following are conflicts, not tie-breakers:

- an explicit tenant field that disagrees with an approved alias or record mapping;
- references that resolve to more than one tenant;
- two tenants with the same business key or document ID space;
- an asset that appears to belong to one tenant but is referenced by confirmed content in another;
- an alias that maps to multiple tenants;
- a tenant that is missing, retired, or closed without an owner decision;
- evidence that is missing, expired for the baseline, or refers to a different subject.

### 5.1 Bounded type-wide rules

A type-wide rule is an exception path, not a default. It is permitted only when the Product Owner approves a rule that names the source type, the exact predicate, the record set, the exclusions, the basis, the evidence, and the validity window. “All records of this type,” “the only tenant in the export,” and “the current deployment” are not predicates. Every record is still evaluated individually; a record that contradicts the rule is blocked rather than swept into the rule. A type-wide rule cannot confirm an alias, an asset tenant set, a principal binding, or a shared/global grant. Security review is required if the rule could cross a tenant boundary.

Do not resolve a conflict by majority, recency, “primary tenant,” largest reference count, uploader, or the first row encountered. Do not merge records or split one source record across tenants. A content record belongs to exactly one tenant or is explicitly retired; shared content is not an ownership state.

C0 is read-only. If the source data is wrong, the outcome is `ambiguous`, `unresolved`, `blocked`, or owner-approved `retired`, not an edit to Sanity. A later source correction requires a new baseline and a new manifest.

## 6. Alias approval

### 6.1 Build the exact alias inventory

Enumerate every distinct legacy identifier that could be used for ownership: `companyId`, `legacyTenantId`, and `other`. Do not case-fold, trim, slugify, or normalize values for matching. Exact equality is the default; any transformation requires its own approved rule and must preserve the original value.

The alias register records `aliasType`, private `aliasValue`, target `tenantId`, `status` (`approved` or `rejected`), `basis`, `evidenceRef`, `approvedBy`, `approvedAt`, and `decisionRef`. A candidate without a decision stays in the private working register as `pending` and is not written to the control-plane alias register. A rejected alias remains in the private register with its reason; it is not deleted. A later proposal is a new decision, not an overwrite.

### 6.2 Approval matrix

| Alias case | Required approval |
|---|---|
| Maps to one existing tenant, no collision, no cross-tenant use. | Tenant Authority for that tenant; Product Owner countersigns the aggregate alias register. |
| Reused by multiple tenants, touches a closed tenant, or changes an existing approved mapping. | Every affected Tenant Authority, Security reviewer, and Product Owner. |
| Rejected. | The affected Tenant Authority and Product Owner, with a written reason. |
| Alias value resembles a slug, display name, email, filename, URL, or person's name. | Reject unless a separate owner-approved rule establishes that the value is a stable legacy identifier. It is never used as a convenience match. |

An alias may map to one tenant only. Many aliases may map to one tenant. A single alias cannot be “shared” between tenants; that is a conflict, not a shared asset.

### 6.3 Alias effects

- Alias approval is not record approval. Every record still needs a confirmed mapping.
- `companyId` is preserved as `legacyCompanyId`; it is never copied into `tenantId`.
- An alias approval is invalidated by a tenant rename, tenant closure, merge, split, or registry-status change until re-reviewed.
- The public manifest exposes alias counts only: approved, rejected, and conflicts. It never exposes an alias value or a per-tenant alias count.

## 7. Shared-asset tenant sets

### 7.1 Preconditions

Do not classify an asset as shared until:

- its bytes exist and independently verify;
- every content record that references it has a confirmed tenant or is owner-approved retired, and every retired reference is listed separately from the active reference set;
- the asset has no tenant-private filename, metadata, or embedded content;
- the steward tenant is named;
- a single retention and legal-hold policy can govern every entitled tenant;
- the public/private visibility decision is recorded.

A shared asset never supplies evidence for content ownership. Content ownership is resolved first; the asset tenant set is derived from confirmed references plus explicit approved grants.

### 7.2 Disposition

| Condition | C0 disposition | C0 action |
|---|---|---|
| Exactly one confirmed tenant references the asset. | `exclusive` | Record one tenant. No native asset is created in C0. |
| Multiple confirmed tenants reference the asset, with no shared approval. | `copies-required` | Record the exact reference tenant set. Plan distinct native IDs and keys for each tenant; do not share or deduplicate by SHA-256. |
| Multiple tenants, immutable common bytes, and a complete shared approval. | `shared` | Record the steward, exact approved tenant set, one confirmed grant per tenant, retention, legal hold, and decision reference. |
| No confirmed reference and no owner classification. | `global-or-orphan` | Do not create an active asset. Keep the asset in the manifest and require an owner decision. |
| Missing binary, unresolved reference, hash mismatch, or an unresolved referencing record. | `blocked` | No ownership claim and no delivery. |

A multi-tenant asset is never silently assigned to one tenant and never silently shared. `copies-required` is an approved plan, not a native copy operation.

### 7.3 Shared approval package

The private approval package contains:

- private source asset ID and native asset ID placeholder;
- measured MIME type, byte size, and SHA-256;
- steward tenant;
- `referenceTenantSet`, derived only from confirmed, non-retired content references; retired references are listed separately and cannot justify a grant;
- `approvedTenantSet`, listed explicitly and never expressed as “all tenants”;
- one `asset_ownership` grant per approved tenant, with `grantScope` and `status = confirmed`;
- retention policy and legal-hold status;
- public/private visibility and any public-asset approval;
- the decision reference and evidence references;
- every Tenant Authority approval, the Product Owner approval, and Security review when the grant is global or public.

Every tenant in `referenceTenantSet` must appear in `approvedTenantSet`. Additional approved tenants must be named and justified; they are never inferred. If any entitled Tenant Authority objects, or any required grant is missing, the shared disposition fails closed to `copies-required` or `blocked`.

A `global` grant is explicit. It enumerates the currently entitled tenants and records a named rule for adding a future tenant. It is not an any-tenant wildcard, and adding a tenant is a new audited decision.

### 7.4 Prohibited asset inferences

Do not derive a tenant set from:

- a storage path, URL path, CDN hostname, or signed URL;
- the original filename, title, alt text, caption, or metadata;
- the uploader, creator, last editor, or owner field;
- SHA-256 equality with another tenant's asset;
- the asset's position in a page or the first reference encountered;
- a seed fixture, demo dataset, or environment variable.

## 8. Conflict states and terminal outcomes

| State | Meaning | May appear in a signed C0 manifest? |
|---|---|---|
| `confirmed` | A named authority confirmed this subject to exactly one tenant with evidence. | Yes. |
| `candidate` | Reference closure supports a tenant, but no owner has confirmed it. | No. |
| `ambiguous` | Multiple tenants or conflicting evidence remain. | No. |
| `unresolved` | No tenant evidence exists. | No. |
| `retired` | The owner approved exclusion with a migration note; the record is not imported. | Yes, as retired. |
| `blocked` | Missing binary, missing evidence, missing approval, or an invalid alias/asset claim. | No. |
| `pending` | An alias has no approval or rejection decision yet. | No. |

Every `candidate`, `ambiguous`, `unresolved`, and `blocked` subject blocks C0 ownership sign-off. A partial manifest may be produced for review with `status: blocked`, but it cannot be signed as accepted.

Conflict resolution options are limited to:

1. produce new, specific evidence and obtain the required authority approval;
2. retire the subject with an owner-approved migration note;
3. correct the source in a separate, non-C0 change and rerun the baseline;
4. leave the subject blocked.

An owner decision records the subject set, the tenant, the from-state and to-state, the basis, the exclusions, the evidence references, the approver, the timestamp, and an explicit statement that no assumption or default was used. There is no “confirm the majority,” “keep the current UI working,” or “use the tenant that owns the deployment” option.

## 9. Private ownership pack

The private pack is the evidence set behind the manifest. It contains:

- the per-record candidate and decision register;
- the full alias register;
- the full asset ownership register with `referenceTenantSet` and `approvedTenantSet`;
- the shared/global approval packages;
- the principal-to-tenant binding register;
- signed attestations and owner decisions;
- the canonical private manifest and its digest;
- a private index mapping each evidence ID to its source location.

Store the pack outside the Git worktree, access-controlled, encrypted at rest, and available only to the ownership preparer, Security reviewer, Product Owner, and the C1/C5 operators who need it. Do not put private IDs, tenant IDs, asset URLs, filenames, aliases, or payloads in the repository, the public manifest, or the evidence note.

## 10. Redacted ownership manifest

### 10.1 Shape

The public manifest is canonical JSON. It contains aggregates and digests only:

```json
{
  "schemaVersion": "c0-ownership-v1",
  "status": "blocked",
  "baselineId": "<uuid-v4>",
  "generatedAt": "<UTC timestamp>",
  "scopeDigest": "<sha256>",
  "sourceContentDigest": "<sha256>",
  "ownershipPackDigest": "<sha256>",
  "records": {
    "total": 0,
    "byStatus": {
      "confirmed": 0,
      "candidate": 0,
      "ambiguous": 0,
      "unresolved": 0,
      "retired": 0,
      "blocked": 0
    },
    "bySourceType": {}
  },
  "assets": {
    "total": 0,
    "byDisposition": {
      "exclusive": 0,
      "copiesRequired": 0,
      "shared": 0,
      "globalOrphan": 0,
      "blocked": 0
    },
    "sharedGrants": 0,
    "globalGrants": 0
  },
  "aliases": {
    "approved": 0,
    "rejected": 0,
    "pending": 0,
    "conflicts": 0
  },
  "evidence": {
    "byType": {},
    "missing": 0,
    "conflicts": 0
  },
  "checks": {
    "zeroAmbiguous": false,
    "zeroUnresolved": false,
    "zeroBlocked": false,
    "allCandidatesResolved": false,
    "allAliasesDecided": false,
    "rootOrganizationsConfirmed": false,
    "sharedAssetSetsApproved": false,
    "principalBindingsValidated": false,
    "noPrivateData": false,
    "digestsVerify": false
  },
  "signoff": null
}
```

`bySourceType` uses the exact 36 source type names and the same status counts. It never contains per-tenant counts or tenant-set sizes. `evidence.byType` uses the evidence-class identifiers `sourceTenant`, `tenantAlias`, `recordMapping`, `typeWideRule`, `referenceClosure`, `ownerAttestation`, and `assetReferenceSet`. `ownershipPackDigest` covers the canonical private ownership register; `sourceContentDigest` covers the verified content export. A public digest of a low-entropy value is not redaction; do not publish per-record hashes of IDs, aliases, filenames, or tenant names. When signed, `signoff` is an object with `role` (`Product Owner`), `signedAt`, `statement`, `statementDigest`, `manifestDigest` (over the manifest with `signoff` omitted), and `signature`; it never contains a personal identifier beyond the approved role.

Canonical JSON recursively sorts object keys, preserves array order, and uses no insignificant whitespace. `manifestDigest` is SHA-256 over the canonical manifest with `signoff` omitted. `statementDigest` is SHA-256 over the UTF-8 sign-off statement text. Digests may be written with or without a `sha256:` prefix.

`baselineId` is a random UUID v4. It must not encode a tenant, slug, date, dataset, or other human-meaningful name. A name-derived UUID (v3 or v5) is not opaque and is refused; a UUID is a correlation key, not an ownership claim.

`c0-ownership-v1` remains the draft schema because no manifest exists yet. The first frozen or signed manifest freezes v1. Any later field or meaning change requires a new schema version such as `c0-ownership-v2`; v1 must not be reused for a changed shape, and the gate must add explicit v2 support rather than silently accepting a changed v1.

### 10.2 Redaction rules

The public manifest must not contain:

- full or partial document IDs, asset IDs, principal IDs, or tenant IDs;
- tenant names, aliases, `companyId` values, emails, URLs, filenames, or storage keys;
- per-tenant record counts, asset counts, or tenant-set sizes;
- payload bodies, excerpts, history transactions, or signed confirmations;
- credentials, token fingerprints, or secret-store paths;
- a hash of a value whose source space is small enough to enumerate.

Type names, aggregate counts, status names, disposition names, and aggregate digests are permitted. Production counts are published only with Product Owner approval; otherwise the public record uses banded counts and records the banding rule.

### 10.3 Checks

All checks must be `true` before `status` may become `signed`:

- zero `ambiguous`, zero `unresolved`, zero `blocked`, and zero unresolved `candidate` records;
- every retired record has an owner-approved migration note;
- every alias is approved or rejected, with `aliases.pending` and `aliases.conflicts` both zero;
- every tenant's root organization is confirmed, or the tenant has an approved exception;
- every shared asset has a complete `approvedTenantSet` and matching confirmed grants;
- every global grant is enumerated and approved, not a wildcard;
- every principal-to-tenant binding is validated against the registry;
- the private and public digests verify from a clean read;
- the redaction scan finds no private identifier or payload.

The structural public-manifest gate is:

```sh
npm run native:c0:gate -- <manifest.json>
```

It exits 2 for invalid input, 1 for a structurally valid `blocked` manifest, and 0 only for a signed manifest with zero blockers and matching internal digests. It enforces the public shape, aggregate consistency, source/evidence names, redaction-by-shape, and the sign-off statement and manifest digests. It does **not** verify signature authenticity, the private ownership pack, the source export, or individual ownership decisions; those remain the §11 sign-off sequence. A passing gate is a precondition for C0 exit, not C0 exit.

## 11. Owner sign-off

### 11.1 Sign-off statement

The Product Owner signs a canonical sign-off payload containing the public manifest digest, computed with the `signoff` field omitted, and this statement:

> I confirm, for the named C0 baseline, that every retained content record is confirmed to exactly one tenant or retired by an owner-approved decision; every alias is approved or rejected; every shared asset has an exact approved tenant set and a confirmed grant for every entitled tenant; every principal binding was validated; and the redacted manifest contains no private data. I confirm that no ownership was assigned from an environment default, display name, slug, filename, uploader, hash, seed fixture, or reference agreement alone.

The statement is not a claim that the content is correct, that assets are imported, that tenant isolation is implemented, or that C5 parity passes.

### 11.2 Sign-off sequence

1. The ownership preparer freezes the private register, computes the private digest, and computes the canonical public manifest digest with `signoff` omitted.
2. Security reviewer runs the redaction scan and reviews shared/global approvals.
3. Each Tenant Authority attests their record sets, aliases, and shared grants.
4. The Product Owner reviews the public manifest, the conflict count, the exception list, and the sign-off statement.
5. The Product Owner signs the canonical payload and statement. The signature, signer role, timestamp, and public manifest digest are recorded.
6. The Technical baseline lead verifies that the signed digest matches the frozen private pack and that the public record reproduces the digest.
7. The signed manifest and evidence note are committed; the private pack is handed to C1/C5 through the approved private channel.

A signature is invalid if any input changes: baseline, export, scope, alias register, tenant status, record decision, asset disposition, tenant set, grant, or public manifest. Corrections create a new manifest version with a new signature. There is no partial acceptance.

## 12. Fault injection and acceptance checks

The procedure is not accepted until it fails closed on at least these cases:

- a record with no tenant evidence stays `unresolved`;
- a `QUICKSILVER_TENANT_ID`, default tenant, slug, display name, email, filename, uploader, or hash cannot confirm ownership;
- an explicit tenant field that conflicts with an approved alias becomes `ambiguous`;
- an alias mapping to two tenants becomes a conflict, not a preference;
- reference agreement alone produces `candidate`, not `confirmed`;
- a multi-tenant asset without shared approval becomes `copies-required`, not shared;
- a shared asset missing one tenant grant becomes `blocked`;
- a global grant expressed as a wildcard is refused;
- a shared asset referencing an unresolved content record is `blocked`;
- a candidate counted as confirmed fails the manifest;
- a public manifest containing an ID, alias, tenant name, URL, filename, or per-tenant count fails redaction;
- a digest mismatch, stale baseline, or changed tenant status invalidates the signature;
- a signature by anyone other than the Product Owner fails;
- a private pack copied into the worktree fails the procedure;
- a “successful” run with any skipped check exits non-zero and produces no signed manifest.

The procedure may be exercised only on synthetic or approved private data. It does not create a test harness, schema, repository, importer, or route by this document.

## 13. C0 exit and handoff

The ownership gate is complete only when the signed manifest shows:

- **0** `ambiguous`, **0** `unresolved`, and **0** `blocked` retained records;
- every `candidate` resolved to `confirmed` or owner-approved `retired`;
- every alias approved or rejected, with no unresolved alias;
- every shared asset's exact tenant set and grant set approved;
- every principal binding validated;
- all digests and redaction checks passing;
- the Product Owner signature over the exact public manifest.

This gate is necessary but not sufficient for C0 exit. The C0 baseline, asset/deletion reconciliation, scope freeze, `playbook` decision, and owner scope signature are separate requirements in the [cutover plan](native-cms-cutover.md#c0--baseline-inventory-and-scope-freeze).

C1 receives the private ownership pack and the signed public digest. C5 receives the exact `baselineId` and ownership digests. Neither handoff authorizes import, native tombstone creation, provider-status changes, or a production cutover.

## 14. Explicit non-goals

This procedure does not:

- assign ownership from assumptions or defaults;
- edit Sanity records to make ownership resolve;
- create native tenants, records, assets, or grants;
- implement the registry, manifest generator, redaction scanner, or signature verifier;
- decide tenant names, retention periods, purge schedules, public-asset approvals, or shared/global grants;
- replace the C0 asset/deletion baseline or the C1/C5 acceptance gates.

No schema, migration, repository, route, provider, or runtime behavior is changed by this document.
