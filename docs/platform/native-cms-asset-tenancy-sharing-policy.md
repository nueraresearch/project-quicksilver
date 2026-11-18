# Native CMS asset tenancy and sharing policy (draft)

- **Status:** Design-only policy. No object store, schema, migration, route, or runtime code is implemented by this document.
- **Date:** 2026-11-17
- **Scope:** Binary images and files referenced by native CMS content, including Sanity assets migrated by the C0 baseline and future native uploads.
- **Sources:** [C0 asset and deletion baseline](native-cms-c0-asset-deletion-baseline.md), [ADR 0004](adr-0004-native-cms-deletion-tombstones.md), [field mapping and tenant registry](native-cms-field-mapping-tenant-registry.md), [C1 schema and repository map](native-cms-c1-schema-repository-map.md), and the [cutover asset gate](native-cms-cutover.md#55-asset-exportimportverify-gate).
- **Hard rule:** A tenant never gets access to an asset merely because it knows the asset ID or storage key. Ownership, grant, lifecycle, and principal tenant are checked on every delivery.

## 1. Policy decisions at a glance

1. **Exclusive per-tenant copies are the default.** Sharing is an explicit, owner-approved exception, not an automatic deduplication result.
2. **One binary object has one immutable storage key.** Replacing bytes creates a new asset ID and key; it never overwrites the old object.
3. **Private objects stay in a private bucket.** Public delivery uses a separate public bucket and an explicit public-asset approval.
4. **Content deletion does not delete the binary.** An asset follows its references; when references and grants are gone it becomes an orphan, not an automatic purge.
5. **Shared assets require grants.** A shared asset has one binary and an approved tenant grant set. No tenant sees another tenant's references, grant history, or metadata.
6. **Asset deletion is refused while active references or grants exist.** Asset purge is a separate, terminal, owner-approved action.
7. **Delivery is tenant-authorized.** Foreign, missing, and tombstoned assets return 404; purged assets return 410. Raw storage keys are never a client interface.
8. **No implicit global fallback.** A “global” grant is an explicit, audited grant scope; it is never an anonymous or any-tenant default.

## 2. Design records

These are asset-plane records, not additions to the 20 native content collections or the 13 derived stores.

| Record | Required fields | Purpose |
|---|---|---|
| `asset` | `assetId`, `scope` (`exclusive` or `shared`), `stewardTenantId`, `sha256`, `byteSize`, `mimeType`, `lifecycle`, `visibility`, `retentionPolicyId`, `legalHold`, `storageKey`, `sourceAssetId`, `createdAt` | One immutable binary identity and its lifecycle. |
| `asset_ownership` | `assetId`, `tenantId`, `mode` (`exclusive` or `shared`), `grantScope` (`tenant` or `global`), `status` (`confirmed`, `revoked`, or `rejected`), `decisionRef`, `approvedBy`, `approvedAt` | Who may reference or receive the asset. Only `confirmed` ownership grants count; a shared asset has one row per entitled tenant. |
| `asset_reference` | `tenantId`, `contentType`, `contentId`, `fieldPath`, `assetId`, `referenceState` (`active`, `removed`, or `blocked`), `sourceKey` | The reference index used for closure, deletion blocking, counts, and orphan detection. |
| `asset_event` | `assetId`, `tenantId?`, `eventType`, `actor`, `at`, `reason`, `previousEventDigest`, `eventDigest` | Append-only grant, detach, tombstone, restore, purge, and public-visibility events. |

`asset_reference` stores the per-tenant presentation metadata (`alt`, `caption`, `hotspot`, `crop`) separately from the binary. Two tenants may share one binary and still have different alt text or crops.

A shared asset reference is the deliberate exception to the content-only same-tenant relation rule: the content row remains tenant-scoped, the asset is shared, and the `asset_ownership` grant is what permits the pair. The reference index records `(tenantId, assetId)`; an ordinary content-to-content relation still uses the composite tenant key.

`sourceAssetId` preserves the Sanity asset `_id` during migration. Native references use `assetId`; no native content record may retain a Sanity `_ref` or CDN URL.

## 3. Shared assets versus per-tenant copies

### 3.1 Default: exclusive copies

An asset referenced by one tenant is exclusive. A multi-tenant source asset becomes one exclusive copy per tenant unless the shared exception in §3.2 is approved.

| Condition | Result |
|---|---|
| One tenant references the bytes. | Exclusive asset for that tenant. |
| Multiple tenants reference identical bytes, with no owner approval. | One copy per tenant: distinct `assetId`, distinct key, same SHA-256 permitted. |
| Tenants need independent deletion, retention, legal holds, or data residency. | Per-tenant copies. |
| One tenant may become compromised or be offboarded independently. | Per-tenant copies. |
| Bytes differ, even by one byte. | Per-tenant copies; never a shared object with multiple hashes. |
| Asset has tenant-specific filename, metadata, or classification. | Per-tenant copies; shared binaries carry no tenant-private metadata. |
| Source asset has no verified tenant association. | `unresolved`/orphan classification; no active copy until the owner decides. |

Copies are true copies, not aliases: separate records, separate storage keys, separate retention and deletion state. A cross-tenant reference to the original is forbidden.

### 3.2 Shared exception

A shared asset is allowed only when all of the following are true:

- the bytes are identical and immutable;
- the owner/steward and every entitled tenant are named;
- the binary and metadata contain no tenant-private information;
- a single retention and legal-hold policy can govern all entitled tenants;
- the asset is approved as `shared` with a decision reference;
- every entitled tenant has an active `asset_ownership` grant.

Sharing is appropriate for owner-approved brand marks, common templates, or other genuinely common immutable material. It is not appropriate for customer uploads, tenant-specific documents, or anything whose deletion one tenant must control independently.

A `global` grant is still explicit: it is a named grant scope approved by the owner, not a wildcard for future tenants. Adding a tenant to a global grant is an audited decision.

### 3.3 Prohibited deduplication

- Do not deduplicate across tenants by SHA-256 alone.
- Do not convert an exclusive asset to shared in place; create a new shared asset and grant set, then migrate references.
- Do not convert a shared asset to exclusive in place; make per-tenant copies with new IDs and keys.
- Do not let a content write “find” an existing cross-tenant asset by hash.

## 4. Storage keys and buckets

### 4.1 Buckets and trust boundary

| Bucket | Contents | Access |
|---|---|---|
| `qs-cms-private` | Exclusive and shared private assets | No public ACL; object reads only through the delivery service or short-lived signed access. |
| `qs-cms-public` | Explicitly approved public assets | Public read permitted; contains no private tenant data. |
| Staging (optional) | Imported bytes awaiting verification | Private; never delivered; separate from both delivery buckets. |

The object store must block public access at the bucket policy level, not only in application code. A public asset is a distinct asset record and key in the public bucket; promotion creates a new public `assetId` and key and migrates references. A private object is never made public by changing its ACL.

### 4.2 Key format

```text
cms/v1/tenant/<tenant-key>/asset/<asset-id>/<sha256>
cms/v1/shared/<asset-id>/<sha256>
cms-public/v1/<asset-id>/<sha256>
```

- `<tenant-key>` is an opaque, server-generated tenant namespace. It is not a slug, display name, email address, or `companyId`. It is stable across tenant renames.
- `<asset-id>` is the native opaque asset ID.
- `<sha256>` is lowercase hexadecimal over the exact stored bytes.
- No filename, MIME type, title, email, user ID, or tenant display name appears in a key.
- The key is chosen by the server. A client-supplied path, filename, or prefix is never used.
- An exclusive asset’s key stays under its tenant namespace even if the same bytes exist for another tenant.
- A shared asset has one shared key, not one object per tenant.
- A public asset exists only in the public bucket with its own new `assetId` and key; the private object is not made public and is retired only under the deletion rules.
- New bytes always produce a new `assetId` and key. The existing object is immutable and is never overwritten.
- Image transformations and generated variants are new objects with their own keys and lifecycle; they do not mutate the original.

The storage key is an internal locator. It must be redacted from logs, API responses, error messages, and delivery URLs that are shown to users. If a signed object URL is used, the key must already be opaque and the URL must be short-lived; otherwise the delivery service streams the bytes itself.

## 5. Delivery access

### 5.1 Authorization

Public asset URLs, aliases, status responses, and cache revalidation are governed by the [native CMS public-delivery contract](native-cms-public-delivery-contract.md); this section governs asset authorization.

Delivery resolves the asset from `assetId` on the server, then checks:

1. the principal’s authenticated tenant;
2. an active `asset_ownership` grant for that tenant;
3. `asset.lifecycle == active`;
4. at least one active reference, or an explicit owner/admin delivery permission;
5. the asset’s visibility and any public-asset approval.

Knowing an asset ID, a storage key, a Sanity URL, or another tenant’s reference is never authorization.

### 5.2 Responses

| State | Response |
|---|---|
| Missing, foreign-tenant, or tombstoned asset | **404**, with no tenant, key, filename, or existence detail. |
| Purged asset | **410**, retaining the terminal state. |
| Active private asset with a valid grant | Bytes, with a validated MIME type and private cache headers. |
| Active public asset | Bytes from the public bucket, subject to the public approval. |

### 5.3 Delivery controls

- **Same-origin streaming is the default.** The application checks the principal and tenant on every request; it does not rely on object-store ACLs alone.
- **Signed URLs are optional.** If used, they are issued only after the authorization check, expire in at most five minutes, are bound to the exact asset and tenant entitlement, and are not reused as a permanent link.
- **Private caching:** `Cache-Control: private, no-store`; no shared CDN cache; no cache key that omits the tenant or asset version.
- **Public caching:** only public-approved assets; use an immutable content-hash URL. Revocation disables the asset and issues a new version; already-cached public copies may persist until cache expiry, so do not publish anything that must be immediately retractable.
- **Headers:** validate the MIME type, send `X-Content-Type-Options: nosniff`, and set `Content-Disposition` deliberately. Untrusted SVG, HTML, and similar active content is served as an attachment or from a separate asset origin with a restrictive content-security policy; it is never executed inline on the application origin.
- **No listing:** an asset endpoint does not enumerate other assets or reveal reference counts.
- **Logging:** redact signed-query parameters, authorization headers, storage keys, filenames, and tenant display names.

Shared delivery returns the same bytes to each entitled tenant but never another tenant's alt text, caption, crop, reference list, or grant history.

## 6. Deletion and retention behavior

### 6.1 Lifecycle

| Status | Meaning | Delivery |
|---|---|---|
| `active` | Binary exists; not deleted. It may have active references. | Allowed only with an active reference or explicit admin permission. |
| `tombstoned` | Asset deletion event recorded; binary retained. | **404**; not served. |
| `purged` | Binary removed; metadata, digest, and events retained. | **410**; terminal. |
| `archived` | Owner-approved exclusion from active use; binary retained pending retention decision. | Not served. |

An **orphan** is an active asset with zero active references and zero active grants. For an exclusive asset, the single ownership row is the steward’s administration record, not a delivery grant; for a shared asset, the per-tenant `asset_ownership` rows are grants. Orphan is not a fifth lifecycle status. It is blocked from delivery and waits for an explicit tombstone or archive decision.

### 6.2 Rules

1. **Content deletion does not cascade to the binary.** Removing or tombstoning a content record removes its reference and increments the asset event log; the asset remains.
2. **Asset deletion is refused while active references or shared grants exist.** Replace or remove the references first. The exclusive owner row is administrative and does not count as a grant. This prevents a live record from pointing at a deleted asset.
3. **The last reference does not auto-delete.** The asset becomes an orphan; a human or approved retention action must tombstone or archive it.
4. **Shared deletion is not per-tenant.** A tenant must remove its active references before its grant can be revoked; grant revocation with active references is refused. The shared asset is tombstoned only when no active references or grants remain and the steward approves.
5. **Legal hold wins.** A legal hold in any tenant sharing the asset blocks purge for the shared binary. It does not block a tenant from removing its own reference, subject to that tenant’s hold policy.
6. **Purge is separate and terminal.** Purge requires zero active references, zero active shared grants, the retention window elapsed, no legal hold, and owner approval. It removes the bytes; metadata, SHA-256, storage-key history, and asset events remain. A second purge is idempotent.
7. **Tombstoned assets can be restored only while the binary exists.** Restore preserves the asset ID, records a new event, and requires the references to be re-established. A purged asset cannot be restored or recreated under the same ID.
8. **Tenant offboarding does not delete another tenant’s asset.** Exclusive assets follow that tenant’s retention; shared grants are revoked and the object remains while another tenant is entitled. Export/archive before any tenant-specific purge.
9. **No hard delete before C7.** Soft delete is the cutover default; purge is disabled unless a separate owner-approved retention decision enables it.
10. **Delete, restore, and purge are human content-administrator actions.** An agent may propose one but cannot apply it. Every grant, detach, tombstone, restore, archive, and purge appends an asset event with actor, tenant scope, reason, and digest. A failed event write aborts the mutation.

### 6.3 Trigger matrix

| Trigger | Binary | Asset record | Active references | Delivery |
|---|---|---|---|---|
| Content reference removed | Retained | Active, reference count decreases | One fewer | Depends on remaining references |
| Last content reference removed | Retained | Active but orphaned | Zero | Blocked; no auto-delete |
| Tenant grant revoked on shared asset | Retained | Shared, one fewer grant | That tenant’s references must be removed or blocked | That tenant gets 404 |
| Asset soft-deleted | Retained at least 30 days | `tombstoned` | Must be zero | 404 |
| Asset restored | Retained | `active`, new event | Re-established by caller | Allowed with grant/reference |
| Purge approved | Deleted | `purged`, digest retained | Zero | 410 |
| Tenant offboarded | Depends on scope | Exclusive tombstoned; shared grant revoked | Tenant-specific | Other tenants unaffected |

## 7. Migration classification

The C0 baseline can report an asset as `global-or-orphan` or as referenced by multiple tenants. That is evidence, not a native ownership decision. The required resolution, alias approval, tenant-set approval, and redacted manifest workflow is the [C0 ownership resolution and redacted manifest procedure](native-cms-c0-ownership-resolution-manifest.md).

- **One tenant:** import as an exclusive asset.
- **Multiple tenants, no shared approval:** import one exclusive copy per tenant. Preserve the same SHA-256; use distinct native IDs and keys.
- **Multiple tenants, shared approval:** import one shared asset, create one grant per approved tenant, and preserve the approval reference.
- **`global-or-orphan`:** do not create an active asset. Keep it in the manifest, deliver nothing, and require an owner classification: assign to one tenant, create approved copies, approve a shared/global grant, or archive it.
- **Missing binary or hash mismatch:** block the asset; never import metadata as if the binary existed.
- **Purged source asset:** import metadata and digest with `purged` status only when deletion evidence supports it; no binary, no delivery.
- **Tombstoned source asset:** import the tombstone and retained binary; active content may not reference it.

No Sanity CDN URL survives import. Native content references use native asset IDs and native delivery.

## 8. Acceptance invariants

Before C1/C5 can claim the asset plane is ready:

- every active asset has exactly one verified binary and SHA-256;
- no active content references a tombstoned, purged, unresolved, or foreign asset;
- every shared asset has an owner approval and an explicit grant row for every entitled tenant;
- no storage key contains a filename, email, display name, slug, or tenant-visible identifier;
- private buckets have no public ACL;
- a foreign tenant receives 404, and a purged asset receives 410;
- a content deletion cannot cascade to a binary delete;
- an asset delete with active references or grants is refused;
- an orphan is not silently purged;
- a shared asset cannot be purged while one tenant still references it or holds it;
- a purged binary cannot reappear through restore, cache, or a stale URL;
- the round-trip manifest preserves asset ID, SHA-256, MIME type, byte size, status, and tenant grants.

## 9. Non-goals and owner decisions

This policy does not choose the object-store vendor, CDN, encryption product, image-transform service, or retention scheduler. It does not enable purge, define a tenant retention period beyond the 30-day floor, or approve any public asset. It does not change the separate P-025 media-generation contract or its local `QUICKSILVER_MEDIA_DIR` store; if a generated media asset becomes CMS content, it must be registered under this policy rather than linked by filesystem path.

The Product Owner and Security reviewer still own the shared/global grant approvals, public-asset approvals, tenant offboarding retention, legal-hold release, and any purge schedule.

No schema, migration, object-store configuration, route, or runtime code is changed by this document.
