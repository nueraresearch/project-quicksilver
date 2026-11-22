# ADR 0005: Sanity demotion and the global removal gate

- **Status:** Superseded
- **Date:** 2026-11-17
- **Deciders:** Product Owner (Nuera RDL)
- **Supersedes:** none
- **Superseded by:** ADR-0006 ([content parity first](adr-0006-content-parity-first-gate.md))
- **Body digest:** sha256:bb982fbd01ceb512a76c247d348db6f55eca4af0e6220800ac63bafdea1658b6
- **Related:** [ADR 0001](adr-0001-native-first-ownership.md) · [ADR 0002](adr-0002-provider-compatibility-policy.md) · [ADR 0003](adr-0003-native-local-operation.md) · [Native CMS cutover](native-cms-cutover.md) · [Native local operation](native-local.md) · [Native capability matrix](native-capabilities.json) · [Parity tests](parity-tests.md)

This record decides one gate question. It does not change any provider status,
implement a native capability, or authorize a migration. It is proposed for owner
review; the body digest is added when the record is accepted.

## Context

The native capability matrix is both provider-by-provider and global. At version
1 it contains **23 `core: true` rows**: **14 content rows** and **9 non-content
rows** covering local inference, local identity, and native email. The executable
gate, `npm run native:gate`, exits 0 only when every core row is `native` and no
core row requires an external account.

The native CMS cutover has a narrower ambition: replace Sanity for content,
assets, administration, context, and migration, then demote Sanity to an optional
read-only adapter. That raises a real question:

- Must Sanity remain required until local identity, local inference, and native
  email are also complete?
- Or may Sanity become optional once the 14 content rows are native, leaving the
  other required providers to their own gates?
- Or should the CMS work be sequenced behind the other core capabilities rather
  than treated as an independent provider cutover?

The question is not whether the content work is valuable. It is whether a
successful content replacement is sufficient evidence for the product-level claim
"Sanity is optional."

### The rules already in force

[ADR 0003](adr-0003-native-local-operation.md) L2 states the default-backend
removal gate:

> On a clean install with every Sanity and external-Strapi setting unset, every
> core feature must work against the Quicksilver-owned backend. Only after that
> passes may Sanity cease to be required.

That is broader than the 14 content rows. [ADR 0001](adr-0001-native-first-ownership.md)
R1 requires replacement evidence before retirement, and R3 requires a versioned
capability matrix. [ADR 0002](adr-0002-provider-compatibility-policy.md) C5 and C6
apply the same rule to provider defaults.

The matrix also contains a self-referential constraint. The
`content.credential-free-startup` row says it may not be marked native before
every other core row is native. A gate defined as "only the 14 content rows" would
therefore have to either violate that row's own R1 or carve it out. Neither is a
clean provider-scoped rule.

## Decision

### D1 — The removal gate remains global

Sanity may not be demoted from `required` to `optional` until **every capability
marked `core: true` in the versioned matrix is `native`, with
`externalRequired: false`, and has registered evidence** at the matrix version
used for the demotion. At matrix v1 that is all **23** core rows, not only the 14
`content.*` rows.

A future matrix version may add core rows. The gate covers the rows in force at
the demotion, not a frozen count of 23. Removing a core row or changing its
`core` flag requires the same owner decision and evidence as any other matrix
change; it is not a way to make the gate pass.

### D2 — The 14 content rows are necessary, not sufficient

All 14 content rows must still be native, with the C1/C5/C6 evidence required by
the [cutover plan](native-cms-cutover.md). That is the Sanity-specific condition.
It does not replace the other nine core rows:

- `inference.local-planning`
- `inference.local-install`
- `identity.oidc-signin`
- `identity.local-enrollment`
- `identity.session-store`
- `email.smtp-submission`
- `email.starttls`
- `email.inbound`
- `email.live-delivery`

At matrix v1, `inference.local-planning` is already native. The other eight are
not. Sanity stays required until they are.

### D3 — CMS replacement may proceed; C7 follows the other core capabilities

C0 through C6 may proceed in parallel with local identity, local inference, and
native email. The [C6 canary](native-cms-cutover.md#c6--read-shadow-canary-and-one-tenant-write-cutover)
is still useful: it proves one tenant's content path, assets, deletion behavior,
and rollback while Sanity remains authoritative for every other tenant and remains
globally `required`.

What follows the other capabilities is **C7 demotion**, not all CMS work. No C6
canary, successful content rehearsal, or matrix edit is a demotion. C7 may land
only after D1's global evidence exists.

This is the sequencing answer: CMS cutover does not get a separate finish line.
Its replacement work can run first, but its final provider-status change follows
the other core capabilities.

### D4 — No provider-scoped exception by document edit

The 14-row alternative is rejected. It would require superseding ADR 0003 L2, not
merely interpreting it, and it would make the product claim "Sanity is optional"
while the default install still requires an external identity provider, an email
provider, or a hosted model. That is optional in name only.

A future owner decision to adopt a provider-scoped gate must be a new ADR that:

- explicitly supersedes this record and the relevant part of ADR 0003 L2;
- states which providers are independent and which clean-install claim remains;
- defines the replacement evidence and the cross-provider risks;
- keeps `content.credential-free-startup` coherent with the narrowed rule; and
- records why a partial clean install is an acceptable product claim.

Editing `providers[].status`, changing `core` flags, or editing the cutover plan
is not that decision.

### D5 — Provider status changes only after the evidence package

When D1 is met, the demotion is still a separate, reviewed change:

- the capability matrix version is bumped;
- every core row is `native` with test evidence and no external requirement;
- the Sanity provider `status` becomes `optional` and its R1 disposition is
  updated;
- the optional adapter is read-only by default and is tested;
- the dated evidence record and owner/Rollback Authority sign-off are linked; and
- the Sanity dataset, assets, and read-only credentials remain available for the
  retention period in the cutover plan.

No provider status changes in this ADR.

## Why not the 14-row gate

**It contradicts the accepted removal gate.** ADR 0003 L2 is not limited to
content. A 14-row gate would leave the repository claiming that Sanity is optional
while a clean install still cannot run without OIDC, Resend, or a hosted model.

**It makes the clean-install row self-contradictory.** `content.credential-free-startup`
is one of the 14, but its own rule says it cannot be native until every other core
row is native. Narrowing the gate would require either breaking that rule or
special-casing the row that is supposed to prove the removal.

**It creates a false completion signal.** "Sanity optional" would be read as
"the content dependency is gone," but the product would still have three required
external account families. Operators would discover the remaining dependency
after the demotion announcement, when rollback is more expensive.

**It weakens the executable gate without replacing it.** `native:gate` is global,
fail-closed, and already tested. A 14-row gate would need new semantics, a new
exception path, and a new explanation for why the other providers' statuses are
not part of the same clean-install claim.

**The schedule cost is real but visible.** The alternative does not make the other
work disappear; it hides the dependency until later. A visible blocked C7 is
safer than an early demotion followed by a credential-free failure.

## Required evidence

The following evidence is required before Sanity may be demoted. A design
document, a merged implementation, or a matrix status edit is not evidence by
itself.

### 1. Global gate evidence

- `npm run native:gate` exits **0** at the matrix version used for the demotion.
- All core rows are `native`; none has `externalRequired: true`.
- Every core row has a registered test path accepted by the gate; no row is
  skipped, todo, or supported only by prose.
- The matrix version is bumped and the gate output is recorded in the dated
  evidence package.
- No core row was removed, downgraded, or marked non-core to make the gate pass.

### 2. Content evidence

All 14 content rows are native, with at least:

- the C1 50/50 acceptance matrix, zero skipped and zero todo;
- the C0 signed ownership manifest and asset/deletion baseline;
- the C5 real-export rehearsal with zero divergence, verified assets, tombstones,
  snapshot restore, and reverse migration;
- P-118 validation of all 51 API operations against native seeded data;
- P-121 passing on the native path;
- C6 read shadow for at least 7 consecutive days and 14 consecutive days of real
  canary writes with zero unresolved divergence;
- no open Sev-1 or Sev-2 data-integrity incident; and
- a signed C6 canary and rollback drill.

### 3. Non-content core evidence

The nine non-content rows have their own native tests and operational evidence:

- **Local inference:** pinned runtime and model provisioning, checksum
  verification, interrupted-download recovery, model health, and local planning
  without a hosted key.
- **Local identity:** first-owner enrollment, local signing/encryption keys,
  rotation, recovery, revocation, durable sessions, and refusal of remote
  unauthenticated enrollment, self-grants, and invalid sessions.
- **Native email:** SMTP submission, STARTTLS on port 587, inbound MIME/thread
  handling, and a dated live mailbox submission record. A successful SMTP
  submission means server acceptance, not inbox delivery; the evidence must say
  which claim it proves.

Where ADR 0001 R1/R2 or ADR 0003 requires live evidence, a unit test or a
scripted-stream test is not enough.

### 4. Clean-install evidence

- A clean install with every required provider setting absent runs the core
  content, identity, inference, and email paths that the gate marks native.
- `npm run verify`, the web build, and `npm run check:clean-install` pass without a
  Sanity account and without the other required provider accounts.
- The test proves the variables are absent, not merely empty.
- The install does not fall back to a mock in production or silently switch
  providers when a credential is missing.

### 5. Operational evidence

- A native backup/restore drill preserves decisions, approvals, audit chains,
  tombstones, and the content required by the gate.
- The R2 reverse migration and R3 native restore meet the recorded RPO/RTO targets
  in the cutover plan.
- The optional Sanity adapter is read-only by default, conflict/write-back is
  disabled, and the adapter's read path is tested.
- The dated evidence package is reviewed and signed by the Product Owner and the
  Rollback Authority.

## Consequences

**Positive**

- There is one clean-install claim, not a content-only claim that is mistaken for
  a product-level one.
- ADR 0003 L2 and the executable global gate remain consistent; no constitutional
  rule is weakened for schedule convenience.
- C6 canary work remains useful without becoming an early demotion.
- The critical path is visible: the eight non-native non-content rows are named,
  not hidden behind a content milestone.
- A successful C7 cannot leave the default install dependent on OIDC, Resend, or
  a hosted model while claiming Sanity is optional.

**Negative**

- CMS content work may be ready while C7 waits for local identity, inference, and
  email. That delay is real, and Sanity remains a required cost and operational
  dependency during it.
- The gate couples work owned by different teams. A stall in identity or email
  blocks the CMS demotion even when the content replacement is sound.
- The decision creates pressure to edit matrix flags, carve out one row, or
  announce "Sanity optional" early. D4 forbids those shortcuts; review must
  enforce them.
- The 23-row evidence package is larger and slower than a content-only package.

**Neutral**

- C0 through C6 are not blocked. Replacement work, canary evidence, and rollback
  drills can proceed.
- No provider status changes now. Sanity remains `required`; OIDC and Resend
  remain required; hosted-model adapters remain optional.
- A future provider-scoped model is still possible, but only by an explicit
  superseding ADR, not by a status edit.

## What this record does not decide

- The implementation order or dates for local identity, local inference, or native
  email.
- Whether a future ADR should supersede this record and ADR 0003 L2 with a
  provider-scoped gate.
- The design of local identity, model provisioning, SMTP/IMAP, or session storage.
- Which tenant is the C6 canary, or the C6/C7 rollout schedule.
- Any change to the 0.9.0/1.0.0 parity gate.
- Any provider status, schema, migration, route, or runtime behavior.

## Alternatives considered

**Require only the 14 content rows.** Rejected. It contradicts ADR 0003 L2, makes
`content.credential-free-startup` self-contradictory, and would let Sanity be
called optional while the default install still requires other external accounts.

**Require all 23 rows, but block C0-C6 until they pass.** Rejected. The content
replacement and C6 canary are useful, reversible evidence and do not require
Sanity demotion. The global gate governs C7, not the start of replacement work.

**Demote Sanity after C6 with a written exception.** Rejected. An exception that
bypasses the executable gate is the matrix-edit failure this ADR exists to
prevent. If the owner wants a narrower claim, the path is a superseding ADR with a
new clean-install definition.

**Leave the question to the cutover plan.** Rejected. The plan already says the
current gate is global and that only a new ADR may narrow it. Leaving the choice
implicit invites a status edit at the end of C6, when the pressure is highest.

## Review

Re-read this record when:

- the matrix version, core-row count, or `content.credential-free-startup` rule
  changes;
- a provider status is proposed to change;
- a team proposes a provider-scoped gate or a 14-row exception; or
- C6 completes and C7 is requested.

The question that matters while reading it: **does the default install actually
work with every required external account absent, or are we calling Sanity
optional while another required account takes its place?**
