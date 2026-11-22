# Native CMS public-delivery contract (draft)

- **Status:** Design-only contract. No public route, redirect, sitemap, cache rule, event consumer, or runtime code is implemented by this document.
- **Date:** 2026-11-17
- **Scope:** Unauthenticated public delivery of native CMS content, including canonical URLs, slug aliases, publication/delete events, edge caching, sitemap/robots, and preview isolation.
- **Current baseline:** The registered schemas have no public slug field and the web app has no public CMS page. Existing routes are the authenticated console, marked `force-dynamic` with `no-store`. This contract describes a **separate public-delivery plane**; it does not cache or expose the console.
- **Hard rule:** No content type is public by default. Public delivery requires an explicit site registry, content-type allowlist, public projection, and publication record. A published CMS record is not public merely because it exists.

## 1. Public versus authenticated delivery

| Concern | Authenticated console | Public delivery |
|---|---|---|
| Audience | Signed-in principal | Anonymous caller |
| Tenant source | Authenticated principal | Exact public host/site mapping |
| Data source | Tenant-scoped repositories | Immutable public projection |
| Cache | `no-store` | Edge cache with tag revalidation |
| Preview | Authenticated draft view | Tokenized preview, no-store, noindex |
| Error detail | Principal-scoped | No tenant, record, or internal-ID detail |

The public plane must not inherit the console layout's `force-dynamic`/CSP-nonce requirement if that prevents edge caching. It must not share cookies, session state, or console response headers. This contract does not wire the separation.

## 2. Control records

These are delivery-plane records, not new editorial content types.

| Record | Required fields | Purpose |
|---|---|---|
| `public_site` | `siteId`, `tenantId`, `canonicalHost`, `alternateHosts[]`, `pathPrefix`, `status`, `publicContentTypes[]`, `canonicalScheme`, `notFoundPolicy` | Maps an exact public host to one tenant and an allowlisted public surface. |
| `publication` | `publicationId`, `siteId`, `tenantId`, `contentType`, `contentId`, `slug`, `canonicalPath`, `status`, `publishedRevision`, `projectionVersion`, `digest`, `etag`, `publishedAt`, `unpublishedAt` | Immutable identity for one publicly delivered content item. |
| `public_projection` | `publicationId`, `projectionVersion`, `schemaVersion`, `payload`, `digest`, `assetIds[]`, `referenceIds[]` | The allowlisted public representation; never a raw repository row. |
| `route_alias` | `siteId`, `contentType`, `fromPath`, `toPublicationId`, `status`, `createdAt`, `createdBy`, `reason`, `retiredAt` | Permanent slug redirect history. |
| `delivery_event` | `eventId`, `eventType`, `siteId`, `publicationId`, `occurredAt`, `sequence`, `digest`, `previousEventDigest`, `previousPath`, `canonicalPath`, `cacheTags[]` | Transactional outbox for publish/delete/cache work. |

`publicationId` is a public-delivery record. It is not a workflow publication head, a Sanity `_id`, or a tenant ID.

## 3. Public type and field allowlist

- A `public_site` names the content types it publishes. A type absent from that list has no public route.
- Decisions, approvals, authorization/execution audits, money entries, contacts, commitments, chat/inbox, evaluations, traces, OIDC transactions/sessions, and internal policy/risk metadata are never public by default.
- The `public_projection` uses an explicit field allowlist. It excludes tenant IDs, internal record IDs, source revisions, audit fields, private references, contact data, policy details, and storage keys.
- No public projection may resolve a foreign-tenant reference. Shared public assets follow the [asset tenancy and sharing policy](native-cms-asset-tenancy-sharing-policy.md).
- A public projection is generated only from a published revision. Draft, archived, tombstoned, and purged revisions are not public.
- Owner approval is required to add a content type or field to the public surface. Adding a field is a public-contract change, not a routine schema edit.

## 4. URL model and stability

### 4.1 Site resolution

The public host is the tenant boundary:

```text
https://<canonical-host><path-prefix>/<public-segment>/<slug>
```

- `canonicalHost` is exact and allowlisted. Unknown hosts return 404; the response does not list tenants or sites.
- `alternateHosts` redirect to `canonicalHost` with 301; the redirect target is derived only from `public_site`, never from a request parameter.
- `pathPrefix` is an optional opaque site namespace, not a tenant ID, slug, email, or display name.
- The request never selects a tenant with `?tenant=`, a cookie, a header other than the validated host, or a body value.
- HTTP requests redirect to HTTPS with 301; HTTPS is the canonical scheme.

### 4.2 Canonical path

`canonicalPath` is:

```text
<path-prefix>/<public-segment>/<slug>
```

- It contains no record ID, Sanity `_id`, tenant ID, revision, or database key.
- The public segment is fixed per content type and owner-approved.
- The slug is the only variable content segment.
- Query strings are never part of the canonical URL. Tracking parameters are excluded from the canonical link but may be preserved on a redirect.
- A canonical URL has no trailing slash; a trailing-slash request returns 301 to the no-slash form.
- The canonical URL is lowercase ASCII. Uppercase path requests return 301 to lowercase.
- Percent-encoded path separators, `%2f`, `..`, `.`, backslashes, NUL, and double slashes are rejected with 404; they never normalize into another tenant’s or content item’s path.
- Maximum canonical path length is 2,048 characters. Maximum slug length is 80.

### 4.3 Slug grammar

A public slug:

- matches `[a-z0-9]+(?:-[a-z0-9]+)*`;
- has no leading/trailing hyphen and no consecutive hyphens;
- is explicitly assigned and approved by an editor; it is never inferred from a title, ID, filename, or URL;
- is unique within one `siteId` and `contentType`;
- is not a reserved word.

Reserved segments include `api`, `_next`, `sign-in`, `decisions`, `agents`, `workflows`, `monitoring`, `operator`, `entities`, `profile`, `preview`, `sitemap.xml`, `robots.txt`, `404`, and `410`. The list is versioned with the public-site contract.

### 4.4 Stability rules

- A published canonical path remains stable until the editor changes the slug.
- A slug change creates a `route_alias` in the same transaction as the publication update.
- The old path returns 301 to the new canonical path; it is not left as a 404 while the publication exists.
- Alias chains collapse to the current canonical path. If A→B and B→C, A returns 301 to C, not a multi-hop loop.
- An alias cannot be created over a live canonical path, another active alias, a reserved segment, or a different publication’s slug.
- A slug cannot be reused by a different publication while its alias is active.
- Aliases are retained while the publication exists and for at least 12 months after unpublish/delete, unless an owner-approved retirement removes them. A retired alias returns the target’s current status, not a new redirect.
- Alias status is evaluated against the target: published → 301; unpublished → 404; tombstoned → 404; purged → 410.

## 5. Publication status and HTTP behavior

| Publication state | Canonical URL | Alias URL | Cache |
|---|---|---|---|
| `published` | 200 with public projection | 301 to canonical | HTML cacheable |
| `unpublished` | 404 | 404 | Short negative cache |
| `tombstoned` | 404 | 404 | Short negative cache |
| `purged` | 410 | 410 | Short negative cache |
| `restored` and republished | 200 | 301 to canonical | HTML cacheable |
| Missing site | 404 | 404 | No tenant detail |
| Invalid/reserved slug | 404 | 404 | No redirect guessing |
| Preview token valid | 200 draft preview | n/a | `private, no-store`, noindex |
| Preview token missing/invalid | 404 | 404 | No existence detail |

- Public delivery supports `GET` and `HEAD`; other methods return 405 with `Allow: GET, HEAD`.
- `HEAD` returns the same status and headers as `GET`, with no body.
- 404 and 410 responses contain no record body, tenant name, internal ID, or redirect hint.
- A tombstoned record is 404, matching the deletion model; a purged record is 410 and terminal. See [ADR 0004](adr-0004-native-cms-deletion-tombstones.md).
- Unpublishing is not deletion. Unpublish returns 404; the publication and aliases remain for a later restore.
- Restoring a tombstoned record does not automatically publish it. Republish creates or reuses the canonical path and updates aliases.

## 6. Slug redirect correctness

A 301 response:

- uses `Location` with the canonical scheme, host, path, and no internal IDs;
- preserves the original query string unless the redirect target explicitly forbids it;
- never redirects to another host, protocol-relative URL, `javascript:` URL, or a path supplied by the request;
- is not generated from a fuzzy slug match, title similarity, or content-ID lookup;
- is deterministic and idempotent.

Redirect safety checks:

1. Resolve the exact site by validated host.
2. Resolve the exact alias or canonical path.
3. Reject a path with traversal, encoding, case, or slash ambiguity.
4. Resolve the target publication in the same site and content type.
5. If the target is missing/foreign, return 404; if purged, return 410.
6. Emit only the canonical target path.

An alias to a deleted publication does not redirect to a different record. It returns the deleted publication’s status.

## 7. Publish, unpublish, delete, and restore events

### 7.1 Event types

| Event | When | Required effect |
|---|---|---|
| `publication.published` | A new revision becomes public. | Projection, canonical path, aliases, sitemap, cache purge. |
| `publication.updated` | A published revision is replaced. | New projection/digest/ETag, cache purge. |
| `publication.unpublished` | Public availability is withdrawn. | 404 behavior, cache purge. |
| `publication.deleted` | Soft delete/tombstone becomes public. | 404 behavior, cache purge, alias status. |
| `publication.purged` | Binary/payload purge is complete. | 410 behavior, cache purge, terminal alias status. |
| `publication.restored` | A tombstoned record is restored. | Status update; publication remains separate. |
| `route.alias.created` | A slug change creates a permanent redirect. | Alias cache/sitemap update. |

Draft saves, preview renders, private content, and console reads emit no public-delivery event.

### 7.2 Transactional outbox

- The publication/projection change and its `delivery_event` are written in one transaction.
- If the event write fails, the publication change fails. There is no public change without an event.
- The outbox dispatcher is at-least-once. Consumers must be idempotent by `eventId` and ignore stale `sequence`/revision events.
- Event ordering is guaranteed per publication, not globally.
- A failed cache purge does not roll back the publication. It is retried and alerted; the bounded cache TTL limits stale exposure.
- Events are internal records. They contain no raw content payload, private reference, storage key, or credential; public projections never expose a tenant ID.

### 7.3 Cache tags in the event

Every publish/update/delete event carries the tags needed to purge:

```text
site:<siteId>
publication:<publicationId>
path:<sha256(canonicalPath)>
old-path:<sha256(previousPath)>
content-type:<publicType>
asset:<assetId>
sitemap:<siteId>
```

Tags are internal cache keys. They are not public URLs or analytics identifiers.

## 8. Cache and revalidation

### 8.1 Response headers

| Response | Cache-Control | Other |
|---|---|---|
| Published HTML | `public, max-age=0, s-maxage=60, stale-while-revalidate=240` | `ETag`, `Last-Modified`, `Vary: Accept-Encoding` |
| Published asset | `public, max-age=60, s-maxage=60, stale-while-revalidate=240` | Content-addressed native asset URL; bytes immutable, but availability is revocable, so the URL is not permanently cacheable |
| 301 alias/host/slash/case | `public, max-age=300, s-maxage=300` | Exact `Location` |
| 404/410 | `public, max-age=0, s-maxage=30` | No tenant/record detail |
| Sitemap | `public, max-age=0, s-maxage=300, stale-while-revalidate=300` | Site-scoped |
| Preview | `private, no-store` | `X-Robots-Tag: noindex` |
| Console | `no-store` | Existing authenticated behavior |

- `ETag` is derived from the public projection digest plus projection version.
- `If-None-Match` returns 304 with no body when the digest matches.
- `Last-Modified` is the publication's public `updatedAt`, not the database write time.
- Public responses must not set cookies or depend on session state.
- Published pages must not be cached under a URL that contains a preview token or draft ID.

### 8.2 Purge behavior

The cache consumer processes `publication.*` events and purges:

- the publication tag;
- the canonical path tag;
- the previous path tag after a slug change;
- every active alias path tag;
- the site/content-type tags where the site index or listing depends on the change;
- the sitemap tag;
- every asset tag in the event.

Purge is idempotent. A duplicate event is harmless. A successful purge acknowledgement is recorded; a missing acknowledgement is retried with bounded backoff. Path purge is the fallback when a CDN cannot purge tags.

### 8.3 Staleness budget

- Publish/update visibility target: **≤ 60 seconds** after the public transaction commits and the event is dispatched.
- Unpublish/delete/purge visibility target: **≤ 30 seconds**; hard maximum **5 minutes** through the negative-cache/TTL bound.
- A purge failure is an operational incident, not a successful delivery. The site must not claim immediate deletion while a stale page can still be served.
- Cache tags and purge receipts are retained for at least the maximum TTL window so a missed event can be reconciled.

## 9. Sitemap, robots, and canonical metadata

- A sitemap lists only published canonical URLs. It excludes aliases, drafts, unpublished, tombstoned, purged, preview, and private content.
- `lastmod` is the public publication update time, not the database read time.
- A sitemap split respects the 50,000-URL/50 MB limit; a sitemap index is site-scoped.
- `robots.txt` disallows `/api`, `/preview`, and the authenticated console; it points to the public sitemap.
- Published HTML includes a canonical link to its exact canonical URL.
- Preview and negative responses are `noindex`; they never advertise a canonical URL for a draft.
- A slug change updates the sitemap and canonical metadata in the same publication event.

## 10. Public projection and isolation

A public projection is generated only after all of these pass:

- the site is active and the content type is in `publicContentTypes`;
- the publication is published and its revision is published;
- the slug is valid and unique in the site/type;
- every required reference resolves in the same tenant;
- every required asset is public and resolves under the asset policy;
- no field outside the public allowlist is present;
- no rich-text node is unknown, quarantined, or unresolved under the [rich-text contract](native-cms-rich-text-parity-contract.md).

A projection failure blocks publication; it does not emit a partial page or fall back to a draft. A cross-tenant reference or private asset is a publication failure, not an omitted field.

## 11. Fixtures and acceptance gates

These are planned fixtures, not test code. Every fixture records the request host/path/method, site/publication state, expected status, headers, `Location`, cache tags, and event effects.

| ID | Fixture | Expected |
|---|---|---|
| **PD-01** | Canonical site, type, slug | 200; exact canonical path; no ID/tenant in URL |
| **PD-02** | Invalid, reserved, Unicode, traversal, encoded slash, case, trailing slash | 404 or exact 301 normalization; no open redirect |
| **PD-03** | Slug change with alias | Old path 301 to new canonical; new path 200 |
| **PD-04** | Alias chain A→B→C | A 301 directly to C; no loop |
| **PD-05** | Alias collision or slug reuse | Publish refused; no overwrite; existing route intact |
| **PD-06** | Alternate host and HTTP request | 301 to canonical HTTPS host/path |
| **PD-07** | Unknown host/site | 404; no tenant list or record detail |
| **PD-08** | Unpublished publication | 404; aliases 404; no stale body |
| **PD-09** | Tombstoned publication | 404; aliases 404; no body |
| **PD-10** | Purged publication | 410; aliases 410; terminal |
| **PD-11** | Restore then republish | 200; prior aliases resolve to current path |
| **PD-12** | Publish event/outbox failure | Publication fails; no event-less public change |
| **PD-13** | Duplicate/out-of-order events | One effective purge; stale event does not regress state |
| **PD-14** | Cache headers, ETag, If-None-Match | Correct TTL, digest, 304, no cookies |
| **PD-15** | Tag purge and path fallback | Canonical, old path, aliases, sitemap, assets purged |
| **PD-16** | Purge failure/retry | Bounded stale window; alert; no false success |
| **PD-17** | Sitemap/robots/canonical | Only published canonical URLs; no aliases/drafts/private |
| **PD-18** | Preview token | 200 preview with `private, no-store`, noindex; no public cache |
| **PD-19** | Private/cross-tenant projection | Publication refused; no partial page or foreign detail |
| **PD-20** | Draft or archived revision | Not public; 404; no draft fallback |
| **PD-21** | Public versus private asset | Public asset delivered; private asset blocks publication |
| **PD-22** | Alias to deleted target | 404 or 410 matching target; no redirect to another record |
| **PD-23** | Sitemap after delete/slug change | Deleted URL absent; new canonical present; old alias excluded |
| **PD-24** | Event/cache idempotency | Repeated events and purge receipts do not duplicate effects |

Acceptance gates:

- **PD-G1 URL stability:** canonical paths are deterministic, ID-free, tenant-safe, and stable across restarts.
- **PD-G2 Redirect safety:** only exact same-site 301s; no open redirect, traversal, alias loop, or cross-site target.
- **PD-G3 Status correctness:** published 200, unpublished/tombstoned 404, purged 410, preview isolated.
- **PD-G4 Event integrity:** transactional outbox, at-least-once dispatch, idempotent consumers, no event-less publish/delete.
- **PD-G5 Cache correctness:** headers, ETag/304, tag/path purge, bounded stale window, purge-failure alerting.
- **PD-G6 Isolation:** public projection excludes private/foreign data and never falls back to a draft.
- **PD-G7 Discovery:** sitemap/robots/canonical metadata reflect only published canonical URLs.
- **PD-G8 Evidence:** all 24 fixtures pass with zero skipped and zero todo.

## 12. Evidence artifacts

- `public-delivery-report`: PD-01–PD-24 results, host/path/status/header matrix, redirect map, and cache-tag map.
- `slug-alias-manifest`: canonical paths, alias graph, collision checks, and retired aliases; private content IDs stay out of the public copy.
- `publication-event-log`: event IDs, sequences, outbox state, consumer acknowledgements, and stale-event refusals.
- `cache-header-matrix`: HTML, asset, redirect, negative, sitemap, preview, and console headers.
- `purge-ack-report`: tag/path purges, retries, failures, and measured stale windows.
- `sitemap-snapshot`: canonical URLs only, with lastmod and exclusions.
- `preview-safety-report`: token handling, no-store, noindex, and no public cache key.

The public evidence copy contains no tenant IDs, private content IDs, preview tokens, cookies, or credentials.

## 13. Dependencies and stop points

| Dependency | Why |
|---|---|
| C0 public-type decision and field mapping | Decides what may be public and which fields are exposed. |
| C1 publication/revision/tombstone model | Supplies published revisions, 404/410 behavior, and tenant scope. |
| Asset policy | Supplies public asset eligibility and native delivery. |
| Rich-text contract | Ensures public rich text has no unknown or unresolved nodes. |
| C2 route/API layer | Supplies the public render and request path; this contract does not wire it. |
| C5 real-export rehearsal | Proves production-shaped public projection, aliases, and cache behavior. |

Stop points:

1. Stop before a public type is added without owner approval and a public-projection field allowlist.
2. Stop before a site is served without an exact `public_site` host mapping.
3. Stop before a slug is published without uniqueness, reserved-word, traversal, and alias-collision checks.
4. Stop before a publish/delete changes public state without a transactional delivery event.
5. Stop before caching any public response without ETag, cache tags, purge path, and bounded TTL.
6. Stop if a purge failure can be reported as immediate deletion or if stale exposure exceeds the stated budget.
7. Stop if a preview, draft, private field, foreign reference, or private asset can enter the public cache.
8. Do not claim public delivery, C2 completion, or C5 parity from fixture-only evidence.

## 14. Explicit non-goals

This contract does not:

- add public pages, route groups, redirects, sitemap/robots handlers, or cache middleware;
- choose a CDN, object store, or image delivery vendor;
- define the full public information architecture or content-type list;
- add a slug field to Sanity or generate slugs from titles;
- change the authenticated console, C1 50-case gate, C2 API contract, C5 migration, or provider status;
- authorize publication of any current content.

No schema, route, provider, cache, or runtime behavior is changed by this document.
