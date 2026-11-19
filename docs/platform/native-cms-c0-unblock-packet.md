# C0 unblock packet (draft)

- **Status:** Design-only review sheet. Nothing here runs an export, freezes Sanity, imports data, touches credentials, signs a manifest, changes a provider status, or authorizes C1 code.
- **Date:** 2026-11-18
- **Purpose:** one page for the five things that actually hold C0, then the exact order in which they must be decided and signed.
- **Governing records:** [native CMS cutover](native-cms-cutover.md) (C0/C1), [C0 inventory](native-cms-c0-inventory.md), [playbook brief](native-cms-playbook-decision-brief.md), [asset and deletion baseline](native-cms-c0-asset-deletion-baseline.md), [ownership resolution and redacted manifest](native-cms-c0-ownership-resolution-manifest.md), [C1 implementation sequence](native-cms-c1-implementation-sequence.md).
- **Current disposition:** 21 native, 13 derived, 2 optional adapter, 0 retirement — both C0 owner decisions are recorded (2026-11-19: `playbook` retained, chassis = direct native repositories); Sanity `required`; 48 route files / 51 operations; `npm run native:gate` exits 1.

## 1. What blocks C0

| # | Blocker | Decider | Closes when |
|---|---|---|---|
| 1 | ~~`playbook` is still a proposed retirement~~ — **closed 2026-11-19** | Product Owner | Recorded in [brief §6](native-cms-playbook-decision-brief.md#6-sign-off) as retained; the C0 count, C1 scope, and A01 are updated |
| 2 | ~~Persistence adapter/chassis is unchosen~~ — **closed 2026-11-19** | Product Owner, implemented by Content platform | Decided for direct native repositories; the `adapter` value is recorded in §3 for the C1 entry bundle |
| 3 | No production read-only baseline exists | Product Owner authorizes; Technical baseline lead runs | The approved redacted baseline record and its digests exist |
| 4 | Tenant ownership is unresolved | Tenant Authorities and Product Owner | The redacted manifest is signed with zero blockers and the C0 gate exits 0 |
| 5 | C0 scope and known behavior differences are unsigned | Product Owner | The C0 scope note, including the difference list and accepting owner per item, is signed |
| 6 | No C1 entry bundle exists | Product Owner and Security reviewer | All seven entry-bundle inputs are signed |

Blockers 1–5 are C0 exit. Blocker 6 is C1 Stage 0; it consumes C0's output.

## 2. Decision 1 — `playbook` retain or retire

`playbook` is the only C0 type still marked **Retirement — owner approval required**. The kernel capability exists and is tested (P-067, P-068, P-069, P-074, P-082); the runtime reads `deploy/playbooks/*.json`; the Studio type is registered but has no seed, route, query, or action; a zero seed count is not a zero production count.

| | **Retain as native** | **Retire the Sanity type** |
|---|---|---|
| C0 count | 21 native, 13 derived, 2 adapter, 0 retirement | 20 native, 13 derived, 2 adapter, 1 approved retirement |
| C1 scope | 34 stores; add field map, ownership row, repository; A01 becomes 21 + 13 | 33 stores; A01 stays 20 + 13 |
| Baseline | Include `playbook` in `scopeTypes` and import validated documents | Include `playbook` in `scopeTypes`; count it, archive any documents with a digest, import none |
| Runtime | No change; deploy JSON stays authoritative until M4 | No change; deploy JSON stays authoritative |
| Product text | Consistent with current "Playbooks as content" and M4 | Requires updating that wording in the same decision |

Either way the export counts `playbook` documents; neither option may claim a production count from the seed baseline. Record the decision in the brief's sign-off block, then update the inventory count and, if retained, the C1 map and A01 before any C1 code.

**Recorded 2026-11-19 — retained, scope-fenced.** [Brief §6](native-cms-playbook-decision-brief.md#6-sign-off) records Option A. The inventory count is now **21 native, 13 derived, 2 optional adapter, 0 retirement**; C1 is **34 stores**, `C1-A01` expects **21 native + 13 derived**, and the [C1 map](native-cms-c1-schema-repository-map.md#3-native-collections-21) carries the `qs_playbooks` collection. `deploy/playbooks/*.json` remains the runtime authority, with no native admin screen or write path before M4 integration.

## 3. Decision 2 — persistence adapter/chassis

The question is whether the C1 repositories run on the **Strapi chassis** or directly on **native repositories**. It is not a question about authority: the kernel authorizes either way, and Strapi is a scaffold today — not a host, dependency, or runtime registration.

| | **A. Strapi chassis** | **B. Direct native repositories** |
|---|---|---|
| Shape | Quicksilver plugin registers the collection types; repositories sit above Strapi | The store catalog is owned schema plus repositories, with no Strapi host |
| What it buys | Existing ten ontology collection schemas and plugin registration stay the starting point | No vendored CMS host or dependency to keep current |
| What it costs | Needs a Strapi host and dependency before the chassis can be claimed; Strapi's relation model cannot express composite tenant keys, so the repository layer must still enforce them | The ten ontology schemas must be restated in the native catalog; any CMS conveniences are rebuilt |
| Invariants | Composite tenant keys, revisions, idempotency, append-only audit, and the six query contracts are enforced in the repository | Same invariants, same place |

Rules that do not depend on the choice: no external Strapi project or Sanity project may be required; A01–A04 must pass with no CMS client, network call, or credential read; `platform.strapi-chassis` stays `partial` until a host actually registers the plugin; and the composite-key and revision rules may not be weakened to fit whichever chassis is chosen.

Record the adapter name and version as the entry bundle's `adapter` field, together with the schema catalog version and relation inventory digest. The chassis choice does not change C0 counts or the ownership manifest.

**Recorded 2026-11-19 — Option B, direct native repositories.** The C1 repositories run on the native store catalog with no CMS host: no Strapi dependency, no plugin registration, and no external Strapi project. Entry-bundle `adapter` value: `direct native repositories (no external CMS host)`; the schema catalog version and relation inventory digest are frozen at C1 Stage 0 as above. `quicksilver/` stays only as an optional-adapter example, and the matrix records the non-adoption instead of an unimplemented scaffold. The composite-key, revision, idempotency, and append-only rules are unchanged, and A01–A04 must still pass with no CMS client, network call, or credential read.

## 4. Read-only production export and asset/deletion baseline

This packet does not run the export. It names what the run must produce so the signing steps in §6 have inputs.

**Preconditions.** Product Owner approves the scope, the freeze window, and use of a dedicated Viewer token. No `SANITY_WRITE_TOKEN` or combined legacy token may be present; no `sanity login`; export commands are reads only; otherwise the run is not a baseline. Strict asset verification stays on — an asset excluded by 401/403/404 is a failure, not a skip. The private directory lives outside the worktree, mode `0700`, encrypted, and no Sanity write may occur during the window. A concurrent write discards the run and requires a new `baselineId`.

**Private artifacts.** `scope.json`; `source-raw.jsonl` and `source-parity.jsonl`; every asset binary with `assets-manifest.json`; `history/deletions.jsonl`, `creations.jsonl`, and pre-baseline evidence; snapshots; `SHA256SUMS.private`. These never enter the repository.

**Public redacted record.** `evidence.md`, `scope.public.json`, `content-summary.json`, `assets-summary.json`, `deletions-summary.json`, and `digests.json`. Allowed: baseline ID, export window, tool versions, type names, counts, status counts, byte totals, MIME classes, digests, pass/fail. Forbidden: document, asset, tenant, user or actor IDs, URLs, storage keys, filenames, payloads, tokens.

**Digests that carry forward.** `scopeDigest`, `contentParityDigest`, `contentSnapshotDigest`, `assetsManifestDigest`, `deletionLedgerDigest`. The content digest becomes `sourceContentDigest` in the ownership manifest; the set supplies the production export digest and the asset/deletion baseline digest in the C1 entry bundle.

**Blocking results.** Any write during the window; any excluded or missing asset; any `unexplained_missing`, `unexpected_deletion`, `restored_missing`, `restore_audit_mismatch`, `resurrected`, or `tombstone_mismatch`; any digest or scope mismatch. Absence is never a deletion, and `tombstones.expected.jsonl` is a C5 import candidate, not a native ledger. C0 creates no native tombstones and imports nothing.

## 5. Ownership evidence

**Private pack.** One candidate row per retained record and asset plus one per alias; the full alias register; the asset ownership register with `referenceTenantSet` and `approvedTenantSet`; shared/global approval packages; principal-to-tenant bindings; signed attestations; the canonical private manifest; and an evidence index. It stays outside the worktree and is shared only with the preparer, Security reviewer, Product Owner, and C1/C5 operators.

**What can confirm ownership.** A validated explicit tenant field, an approved alias mapping to exactly one tenant, an approved record mapping or bounded type-wide rule, or a signed owner attestation. Reference closure only produces `candidate`. An environment default, slug, display name, email, filename, uploader, hash, seed fixture, or "only tenant in the export" confirms nothing.

**Order.** Explicit tenant first, then alias, then approved mapping or bounded rule, then attestation, then reference-closure candidate. Stop at the first contradiction and record `ambiguous`; never resolve by majority, recency, or first row. A shared asset needs an exact `approvedTenantSet`, one confirmed grant per entitled tenant, and an explicit global grant that enumerates tenants rather than a wildcard.

**Manifest exit shape.** `candidate`, `ambiguous`, `unresolved`, and `blocked` all zero; `aliases.pending` and `aliases.conflicts` zero; no blocked asset; every check `true`; `signoff` by the Product Owner over the canonical statement. The gate is `npm run native:c0:gate -- <manifest.json>`; it exits 0 only for that shape, 1 for a structurally valid blocked manifest, and 2 for invalid input. It is structural: it does not verify the signature, the private pack, the export, or an individual ownership decision.

## 6. Exact sign-off sequence

The order matters because each signature consumes the previous artifact. Steps 1 and 2 also have an internal order: the `playbook` decision fixes `scopeTypes` for the export.

1. **Product Owner — `playbook` decision.** **Done 2026-11-19: retained, scope-fenced.** The C0 count, C1 map, A01, and store count are updated to match.
2. **Product Owner — baseline authorization.** Approves scope, freeze window, and Viewer token use; confirms no Sanity writes will run.
3. **Technical baseline lead — run and record.** Executes the read-only export, canonicalization, hashing, and reconciliation; records commands and digests privately.
4. **Security reviewer — read-only and redaction review.** Confirms Viewer-only access, no write credential, private store controls, no private data in the public record.
5. **Product Owner — baseline acceptance.** Approves the redacted baseline record and its digests. A failed or written-during-window run is discarded, not accepted.
6. **Ownership preparer — private register.** Builds the candidate register, alias register, asset tenant sets, and principal bindings from the frozen baseline.
7. **Tenant Authorities — attest.** Each attests its record sets, aliases, and shared-asset grants. Security reviewer reviews cross-tenant conflicts, shared/global grants, and redaction.
8. **Product Owner — sign the public manifest.** Signs the canonical statement; the preparer must not be the sole approver, and at least one independent reviewer attestation is required.
9. **Technical baseline lead — verify the digest.** Confirms `manifestDigest` matches the frozen private pack and the public record reproduces it; runs the gate to exit 0.
10. **Product Owner — sign C0 scope.** Signs the scope note and the known behavior-difference list, naming who accepts each difference.
11. **Product Owner and Security reviewer — sign the C1 entry bundle.** Bundle contents: signed C0 manifest digest, production export digest, asset/deletion baseline digest, `playbook` decision, adapter/chassis decision, schema catalog version, relation inventory digest. Private inputs stay outside the worktree.
12. **C1 Stage 1 may start.** No schema or repository code before step 11; any changed baseline, alias, tenant status, asset decision, or scope creates a new manifest and invalidates the earlier signature. There is no partial acceptance.

## 7. What this packet does not do

No export, freeze, manifest, credential, import, or C1 code. Sanity stays `required`, ADR 0004 and ADR 0005 stay Proposed, C6 stays a one-tenant canary, and public delivery stays design-only. The `playbook` and chassis decisions are recorded (§2, §3); every data-dependent C0 item still requires the read-only export, the signed manifest, and the scope signature.

## 8. Owner checklist

- [x] `playbook`: retain / retire recorded, count updated
- [ ] Baseline scope, freeze, and Viewer token approved
- [ ] Redacted baseline record approved with digests
- [ ] Tenant Authorities attested; Security review complete
- [ ] Redacted manifest signed; gate exits 0
- [ ] C0 scope and difference list signed
- [x] Adapter/chassis chosen and recorded
- [ ] C1 entry bundle signed by owner and Security reviewer
