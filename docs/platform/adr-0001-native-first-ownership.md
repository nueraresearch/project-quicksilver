# ADR 0001: Native-first ownership of the runtime

- **Status:** Accepted
- **Date:** 2026-11-10
- **Deciders:** Product owner (Nuera RDL)
- **Supersedes:** none
- **Superseded by:** none
- **Body digest:** sha256:10a39cd96b8704dd0a3fe80bae022a5c03cd8ab5b93a1797c09717ba35703c33
- **Related:** [Native local operation](native-local.md) · [Parity tests](parity-tests.md) · [Current status](../CURRENT-STATUS.md) · [v1 credential prerequisites](v1-credential-prerequisites.md) · [Threat model](threat-model.md)

This is the first architecture decision record in this repository, and it is
constitutional rather than an implementation plan: it states constraints that
later work is held to, not an order or a schedule. Later records continue the
same folder and numbering.

## Status and amendment

Records in this series are append-only. A record is not rewritten to reflect a
later decision; the later decision is a new, numbered record that supersedes it.
A superseded record keeps its body, so the reason it was decided stays readable
after it stops governing.

Two lines may change after acceptance: `Status` with `Superseded by`, and
`Body digest`. The digest covers the rest of the record, so a correction is
visible in a diff even when it hides inside a large pull request. That is what
it buys — a rewrite can still be made, but not silently. It does not stop
anyone who can commit; review and git history remain the authority.

Concretely:

- To change a constraint this record states, write the next free ADR with
  `Supersedes: ADR-0001`, and set this record's `Superseded by` to that number.
- To correct an accepted record — a broken link, a typo, a stale path — change
  the text and run `npm run adr:seal`. The digest moves in the same diff, which
  is the record of the correction. This needs no new ADR, because nothing about
  the decision changed.
- Quote the constraint being replaced in the new record. "It no longer fits" is
  not a rationale; naming what changed is.
- Numbering is a memory system, not a filing habit: twenty records read in order
  are the project's architectural history, and a gap or a reused number destroys
  that.

`npm run parity:test` checks the mechanics: contiguous numbering from 0001, the
required header fields, supersession recorded on both records and resolvable, an
index entry in the [platform README](README.md), and a body digest that matches
every record in force. It does not check that the prose is right — that is
review's job — and a record nobody can find is not memory.

## Context

Quicksilver's development and test surface leans on third-party services. The
most expensive of these is not the one with the largest bill; it is the one
sitting inside the development loop.

**Sanity is inside that loop.** Without a Sanity credential the guarded web
route handlers answer 401 or 503: 42 of the 46 importable handlers did when
that was measured at `3f7261c`, and the tree is now 48 route files / 51
operations, of which 37 return a validated body only because the
response-schema harness supplies a mocked empty store. `apps/studio` runs
`sanity dev`, which requires `SANITY_STUDIO_PROJECT_ID`. The root `npm run dev` runs dev in
every workspace, so on a clean clone it cannot complete. Content retrieval,
entity creation, planning and workflow testing all sit behind a hosted CMS.

**The other dependencies add accounts, not just cost.** Inference, email and the
Onboard connectors each bring a provider, a key and a lifecycle. Those lifecycles
decay: a Microsoft Entra client secret stops sign-in when it lapses, Intuit
rotates the QuickBooks refresh token on every use, and Studio schema deployment
is still pending on valid project-scoped access. The recurring failure mode is
not a bill arriving — it is a credential expiring, rotating, losing quota or
changing behaviour while nobody is looking, stopping work for reasons unrelated
to the code.

Two different questions are commonly conflated here, and they need separating:

- **Independence (Track A):** can this repository be developed, tested and
  installed without third-party accounts?
- **Interoperability evidence (Track B):** has this code been observed working
  against the real external system it claims to integrate with?

Native replacement answers the first. It cannot answer the second, and this
record does not claim otherwise.

## Decision

Quicksilver owns the runtime. Where an external service is **inside the
development or installation path**, replace it with a Quicksilver-owned
implementation, and keep the external product as an optional adapter.

The target shape is:

```
Quicksilver
 ├─ local content store          (replaces mandatory hosted CMS)
 ├─ local identity               (replaces mandatory hosted IdP)
 ├─ local inference              (replaces mandatory hosted model key)
 ├─ native communications        (SMTP/IMAP, then carrier or modem transports)
 ├─ native workflows             (already owned)
 └─ native administration        (already owned)
```

The goal is that this sequence works with no external configuration and no
credentials:

```bash
git clone <repository> && npm ci && npm run dev
```

`npm run dev` now resolves to the console only, and this holds for it: with no
environment configured, the console starts and `/`, `/sign-in` and
`/api/auth/status` all answer 200. Studio is deliberately outside that path
because it is the optional Sanity admin surface; `npm run dev:studio` now names
the missing variable and the zero-config alternative instead of failing inside
the Sanity CLI loader. Starting every workspace, Studio included, is
`npm run dev:all`.

The promise is enforced rather than asserted. `npm run check:clean-install`
resolves what `npm run dev` actually runs, fails if a workspace that needs
configuration is reachable from it, then starts the console with every provider
credential removed and requires it to answer. It runs as the `clean-install` CI
job, so a change that quietly makes the default path need an account fails
before merge.

### What "native" means here

The definition in [native local operation](native-local.md) governs: native means
Quicksilver owns its data, workflows, administration and UI. It does **not** mean
rewriting TLS, cryptography, databases or model inference engines. Audited
libraries and bundled local runtimes are different from mandatory credentialed
services.

Native also does not mean "no network". Four things cannot be owned, because they
are other people's property or other people's networks:

| Cannot be made native | Why | Consequence |
|---|---|---|
| Money movement | Requires the counterparty's account and settlement | Genesis/Operate evidence always needs a real account |
| Mailbox delivery | Deliverability is the receiving system's decision | A native transport proves submission, never inbox arrival |
| Phone numbers | A number is an address served by a carrier | Needs SIP/PBX or modem and SIM |
| Third-party data | Stripe, HubSpot and QuickBooks records are theirs | A connector reading a local file is a different product |

This matches the existing rule that "native" must not become a claim about
interoperability.

## Consequences

**Positive**

- Determinism. The development loop stops depending on someone else's uptime,
  quota or token rotation.
- Lower credential entropy. The largest class of "work stopped for a non-code
  reason" disappears for the runtime paths.
- Reproducibility. A reader in two years needs the repository, not a stack of
  accounts.
- Testability. Credential-free suites already cover 1403 tests and all nine
  workspace type checks (`npm run verify`), and the web build passes with no
  credentials. Native work extends the same property to running the product,
  not only to testing it.
- Native can generate evidence for itself. The local inference path produced
  dated, quantitative model evidence (P-017, 2026-10-18) with no vendor key.

**Negative**

- Scope. Each replacement is real work, and the surface grows while it happens.
- **Decertification.** Retiring a proven path retires a green parity row with
  it. Google OIDC is currently `covered` with live evidence (P-108, 2026-10-03),
  and the one live provider send on record is Resend (P-095, 2026-10-04). Local
  identity and native SMTP replace exactly those two paths.
- Replacement risk. The retired path has proof; the replacement starts at zero.
  Native SMTP has no real mailbox submission recorded.
- The parity matrix describes an externally configured product. If native
  replacements ship without their own rows, the matrix stops describing what is
  actually built.

**Neutral**

- Optional adapters remain. Sanity and standalone Strapi stay available as
  connectors; neither may be required by a built-in install.

## Rules

**R1 — Retire after replacement.** A provider with live evidence may not be
retired in the same milestone that introduces its replacement. The order is:

1. add the replacement's parity row **with live-evidence criteria**;
2. prove the replacement, or explicitly downgrade the old row to
   `needs operational evidence` with a written rationale and owner;
3. only then change the default and demote the old provider to an optional
   adapter.

Without this rule, a milestone can silently trade a `covered` row for an
unproven one, which is a net loss in release position even when the code is
better.

**R2 — One dated evidence record per milestone.** Every milestone ships at least
one new dated live-evidence record — a real run against a real system, recorded
in the parity matrix or a dated evidence document. Independence work does not
substitute for it: a `resend:check` send proves the transport, not the governed
approval sequence, and the record must say which one it is.

**R3 — Capability matrix before cutover.** Keep a versioned provider-by-provider
capability matrix, as [native local operation](native-local.md) already
requires. No default changes until native behaviour meets or exceeds the current
provider for each recorded feature, with evidence. Features may not quietly
disappear.

**R4 — Missing configuration fails closed.** An unset credential leaves the
feature refusing or in dry run, never guessing and never silently switching
provider. This is already kernel behaviour and applies unchanged to native
paths.

## What this record does not decide

- Which providers are replaced first, or in which milestone.
- Whether local identity replaces OIDC or runs beside it.
- Any change to the 0.9.0/1.0.0 parity gate. The gate still requires all three
  modes with operational evidence; native work does not lower it.
- Any date. The pilot timing in [parity tests](parity-tests.md) is unaffected.

## Alternatives considered

**Keep the hosted services mandatory.** Rejected: it makes the development loop
depend on account state, and it makes the repository hard to reproduce.

**Pause native work until operational evidence is complete.** Rejected as a
blanket rule: it removes the constraint that native work was adopted to fix.
Applied per item, it is exactly rule R1.

**Native-only, with no external adapters.** Rejected: it would make the four
items above unclaimable and remove the evidence path entirely.

## Review

Re-read at each milestone, and before any change in exposure (a public address,
a second user, a customer). The rule that matters when reading it: **Track A
makes Track B affordable; Track B makes Track A credible.**
