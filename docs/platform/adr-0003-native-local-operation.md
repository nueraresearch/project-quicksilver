# ADR 0003: Native local operation

- **Status:** Accepted
- **Date:** 2026-11-10
- **Deciders:** Product owner (Nuera RDL)
- **Supersedes:** none
- **Superseded by:** none
- **Body digest:** sha256:72b2812a8fda9b5bbb2c16ababd044ea3a449aacfc9256c88167e1eb2a2cbc50
- **Related:** [ADR 0001](adr-0001-native-first-ownership.md) · [ADR 0002](adr-0002-provider-compatibility-policy.md) · [Native local operation](native-local.md) · [Parity tests](parity-tests.md) · [Current status](../CURRENT-STATUS.md)

This record was written on 2026-11-10 to capture a definition already in force.
It records what "native" means and what may still require an external service;
it does not describe progress, and the staged delivery table in
[native local operation](native-local.md) is a plan, not a commitment of dates.

## Context

ADR 0001 decides that Quicksilver owns its runtime. It uses "native" as a target
without fixing its boundary, and the word can mean at least three different
promises:

- no network at all;
- no third-party code;
- no third-party *account*.

The first two are false and would be rejected by anyone who reads the dependency
tree. The third is the real one, and the migration plan states it. Without a
record, "native" would be re-litigated in each discussion and could drift toward
whichever meaning was convenient — usually the strongest one, in a document, and
the weakest one, in the code.

## Decision

**L1 — Native means ownership, not authorship of everything.** Quicksilver owns
its data, workflows, administration and user interface. It does not rewrite TLS,
cryptography, databases or model inference engines. Audited libraries and bundled
local runtimes are not the same thing as mandatory credentialed services, and
using them is not a failure of this decision.

**L2 — The default backend removal gate.** On a clean install with every Sanity
and external-Strapi setting unset, every core feature must work against the
Quicksilver-owned backend. Only after that passes may Sanity cease to be
required. Neither Sanity nor a provisioned Strapi service may be required by a
built-in install; both may remain optional adapters and migration sources.

**L3 — Four things cannot be owned, and must stay optional.** Money movement,
mailbox delivery, phone numbers and third-party data belong to other people's
accounts and networks; ADR 0001 records why. The consequence here is narrower and
binding: each of those features must remain optional for unrelated core
workflows. A payment account, a mail provider, a carrier or a vendor record is
never a prerequisite for a local feature that does not use it.

**L4 — Kernel authority is unchanged locally.** Human approval, tenant isolation,
durable audit and fail-closed execution apply identically on a laptop and in a
hosted deployment. A local install is not a mode where authority loosens. Local
credentials may be generated during setup so that a single-owner installation
needs no external identity account; remote unauthenticated enrollment,
self-grants and invalid sessions still refuse.

**L5 — Proven locally means the same thing as proven remotely.** A native
transport can prove submission and never delivery: a successful SMTP result means
the server accepted the message, not that it reached an inbox. Unsupported
configurations refuse rather than degrade — no plaintext downgrade, no fallback
to a hosted provider (C4 in [ADR 0002](adr-0002-provider-compatibility-policy.md)).
Native paths inherit the same prohibition on silent substitution as any other
provider.

## What is in force today

Recorded so the decision is not mistaken for the plan.

| Element | State | Evidence |
|---|---|---|
| Zero-configuration console | **In force.** `npm run dev` starts the console with no environment; Studio is outside that path | ADR 0001; `npm run check:clean-install`; CI `clean-install` |
| Governed SMTP notification transport | **Implemented, not operationally proven.** Implicit TLS on 465, `AUTH PLAIN` only inside verified TLS; no STARTTLS, IMAP, attachments, inbound mail or plaintext downgrade | [native local operation](native-local.md); no live mailbox submission on record |
| Quicksilver-owned default backend | **Not at parity.** A Strapi-compatible ontology/query scaffold exists; there is no Strapi host and the plugin is not loaded at runtime | [Current status](../CURRENT-STATUS.md) |
| Console without a hosted CMS | **Not yet.** Without a Sanity credential the guarded web route handlers answer 401 or 503 — 42 of 46 importable handlers at `3f7261c`, and today 48 route files / 51 operations with 37 validated only against a mocked empty store | ADR 0001; P-118 notes |
| Local identity | **Not implemented.** Stage 4 target: first-owner enrollment, local keys, rotation, recovery, revocation | [native local operation](native-local.md) |
| Local inference | **Partial.** Local BYO-model planning produced dated evidence (P-017, 2026-10-18); automatic runtime provisioning and model installation are targets | [Parity tests](parity-tests.md); [native local operation](native-local.md) |

## Consequences

**Positive**

- The word has one meaning in this repository, so a roadmap item can be judged
  against it instead of against an adjective.
- The removal gate is an existing, testable shape: it is the same question
  `check:clean-install` already answers for the console, extended to features.
- Bound features stay honest. A native SMTP result is reported as acceptance, not
  arrival, which is what the code can actually know.

**Negative**

- Progress is uneven by construction. The console can be zero-configuration while
  the default backend is not at parity, and the table above will keep saying so;
  that gap is the work, not a contradiction.
- L3 permanently caps the claim. Four classes of feature can never be "fully
  native", so any future statement that the product is entirely self-contained is
  false by decision.

**Neutral**

- The migration may keep Strapi as a chassis during transition. L1 permits this;
  L2 is what forbids it from becoming permanent by default.

## What this record does not decide

- Delivery order or timing. The eight stages in
  [native local operation](native-local.md) are proposed stages, and this record
  does not promote them to commitments.
- Whether Strapi remains the implementation chassis after cutover.
- Whether local identity replaces OIDC or runs beside it. ADR 0001 leaves this
  open too, deliberately.
- Packaging, installer format, or which local database and runtime ship.
- Any change to the 0.9.0/1.0.0 parity gate.

## Alternatives considered

**Keep the hosted CMS mandatory.** Rejected: it reintroduces the credential
entropy and account lifecycle that ADR 0001 exists to remove, and it makes the
repository impossible to reproduce without someone else's account.

**Native-only, with no external adapters.** Rejected: it would make L3's four
classes unclaimable and remove the evidence path for them entirely.

**Rewrite inference, cryptography or storage natively.** Rejected by L1: those
are the places where "we wrote it ourselves" is a liability, not an ownership
win.

## Review

Re-read at each stage boundary in [native local operation](native-local.md), and
before any change in exposure (a public address, a second user, a customer). The
question that matters while reading it: **does this feature work with every
provider setting unset, and if not, is that because it is one of the four things
nobody can own?**
