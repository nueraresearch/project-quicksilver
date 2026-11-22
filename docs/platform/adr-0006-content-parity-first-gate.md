# ADR 0006: Content parity first, and a provider-scoped Sanity demotion gate

- **Status:** Accepted
- **Date:** 2026-11-21
- **Deciders:** Product Owner (Nuera RDL)
- **Supersedes:** ADR-0005
- **Superseded by:** none
- **Body digest:** sha256:1563d7ac9ed82d50af19552eaba950f46de5df66e411f7f95c5fd5cac28f08e1

## Context

[ADR 0005](adr-0005-sanity-demotion-global-gate.md) asked whether Sanity may become optional once the 14 content capabilities are native, or only when all 23 core rows are. It was never accepted, so nothing was decided.

The owner's decision, recorded 2026-11-21, is to sequence the work the other way round: **build the content features natively now, and treat Google OIDC, Resend and hosted-model replacement as later workstreams.** Two gates then have to be distinguishable, because they answer different questions:

- *Has the native CMS reached parity?* — a milestone about content.
- *May this provider be retired?* — a per-provider decision, which ADR 0001 R1 ties to replacement evidence.

The [memo](native-gate-scope-recommendation.md) recommended keeping one global gate, on the ground that a content-only gate cannot certify `content.credential-free-startup` while the only sign-in is Google. That objection is real and is answered in D4, not ignored: the terminal row gets the smallest local principal that makes the claim testable.

## Decision

### D1 — Two named gates, one matrix

- **Content-parity gate** — `npm run native:parity:gate`. Scope: the 14 `content.*` core rows. Exits 0 only when all of them are `native` with registered test evidence and no external requirement.
- **Removal gate** — `npm run native:gate`. Unchanged: every `core: true` row, 23 at matrix v1. Still exits 1 today and still governs the product-level claim "no mandatory third-party account".

The matrix stays the single source of truth. Scope is a view over it, not a second list, and neither gate may pass over an empty scope.

### D2 — Sanity demotion follows content parity

Sanity may move from `required` to `optional` when the content-parity gate passes **and** the C0–C6 evidence in the [cutover plan](native-cms-cutover.md) exists: conditions 1 and 3–10 of §7, with condition 2 satisfied by this record. C7 lands as its own reviewed change, still after replacement evidence (R1) and still with the 30-day retention.

Sanity demotion no longer waits for local identity, local model installation or native inbound email. That is the whole of this ADR.

### D3 — No other provider moves

`oidc`, `resend` and `hosted-model` stay `required`, and their R1 lines stand unchanged. The removal gate still blocks their retirement, and this record is not a precedent for them: each needs its own record and its own evidence. Only Sanity is provider-scoped here.

ADR 0003 L2 is not replaced. It continues to govern the default-backend question generally; this record narrows its application to the Sanity demotion only, and ADR 0003 itself is not superseded.

### D4 — The terminal content row gets a local principal, not the identity workstream

`content.credential-free-startup` requires a clean install to serve content with every `SANITY_*` variable absent. Every data-backed route needs a principal, so this needs *a* local principal. It does not need the full identity rows.

Required, as part of C3/C4: first-owner local enrollment with a local credential, a server-side session, and a role check — enough for a native admin to exist and for a clean install to serve content without Google. This is already implied by C3: a native admin/editor with role-aware access cannot be built on Google-only sign-in.

Not required for this gate, and still `absent` in their own rows: key rotation, recovery, revocation, and an OIDC-independent session store beyond the local path. Those remain `identity.local-enrollment` and `identity.session-store` work, judged by the removal gate.

When the minimal principal lands, those rows may honestly become `partial`. They do not become `native` by this ADR.

### D5 — Say which claim each gate supports

- Supported once content parity passes: **"no CMS account is required"**.
- Not supported until the removal gate passes: **"no third-party account is required"**, "fully local", "no accounts".

Docs, README text and any demo copy must use the narrower claim while OIDC is `required`. CURRENT-STATUS carries both gate states so the difference is visible rather than inferred.

## Consequences

- **Content work is no longer gated behind unstarted workstreams.** C2 through C6 can proceed to a finish line that exists.
- **A clean install will still require Google to sign in.** That is accepted and recorded, not hidden: it is the known limitation of shipping content parity first, and D4 narrows it to "sign-in", not "content".
- **The product claim is narrower than the gate it replaces.** Anyone reading "Sanity optional" must not read it as "local install". D5 exists because that confusion is the failure mode this ADR accepts.
- **The removal gate keeps its teeth.** It is not weakened, deleted, or made advisory; it simply stops being the only finish line.

## What this does not do

It does not change `providers[].status`, change a `core` flag, run an export, touch production, or authorize any stage of the cutover. It does not accept, seal or amend ADR 0005 beyond recording that it is superseded. All provider changes remain separate reviewed changes with their own evidence.

## Status and amendment

Accepted 2026-11-21 by the Product Owner. A future decision to widen Sanity's demotion conditions, or to scope another provider this way, supersedes this record rather than editing it.
