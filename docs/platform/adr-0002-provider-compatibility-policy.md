# ADR 0002: Provider compatibility policy

- **Status:** Accepted
- **Date:** 2026-11-10
- **Deciders:** Product owner (Nuera RDL)
- **Supersedes:** none
- **Superseded by:** none
- **Body digest:** sha256:875430b2f82e373ad44152a57ecf526ae5a6c29fea714c154700bee836499937
- **Related:** [ADR 0001](adr-0001-native-first-ownership.md) · [ADR 0003](adr-0003-native-local-operation.md) · [v1 credential prerequisites](v1-credential-prerequisites.md) · [Native local operation](native-local.md) · [Parity tests](parity-tests.md) · [API contract](../api/api-contract.md)

This record was written on 2026-11-10 to capture a policy already in force. It
does not date the decision, and it changes no behaviour: every rule below is
already stated in the linked documents or enforced by code that refuses.

It is about **upstream providers** — the services Quicksilver calls. It is not
about the API or SDK compatibility promise for callers *of* Quicksilver, which
remains undecided and is tracked in [the API contract](../api/api-contract.md).

## Context

[ADR 0001](adr-0001-native-first-ownership.md) decides *where* an external
service may sit in the development and installation path: outside it where
possible, as an optional adapter otherwise. It does not decide what an adapter
must satisfy to be called supported, and the repository has been answering that
question in several places at once — a credential checklist that scopes each
key, a connector that refuses an unrestricted key, a commerce client that
refuses a live key, a routing layer that falls back only on transient failures,
and a migration plan that forbids cutover before feature parity.

Those answers agree with each other. This record makes the agreement explicit so
the next provider is judged the same way as the last one, and so a provider that
merely *works* is not mistaken for one that is supported.

## Decision

Six rules. A provider is **supported** when it satisfies all of them: the
repository will claim it, test it, and answer for it. Code that works against a
provider that does not is a prototype.

**C1 — Scoped credentials, or no support.** A provider is admitted only with a
credential scoped to the capability it serves, and the refusal for a
broader credential is exercised rather than documented. In force today: the
Stripe read connector takes a restricted `rk_test_`/`rk_live_` key with read
access to charges, refunds, subscriptions and disputes only, and refuses an
unrestricted `sk_` key; the HubSpot connector takes a private-app token with one
read scope; QuickBooks defaults to `sandbox` and reaches `production` only when
asked. The same reasoning is why schema-deploy grants are separate from the
application's write token.

**C2 — Test and sandbox families come first.** Where a vendor offers a test mode,
that is the default, and a live credential is refused in code rather than left to
configuration discipline. In force today: commerce actions are off unless the run
configuration sets `commerceMode: "test"`, and the one Stripe write client refuses
a live key. The payment-recording sink takes a webhook *signing secret* and makes
no Stripe call at all, so it cannot move money even when misconfigured.

**C3 — Read before write.** Connectors read by default. A write-back mode needs
explicit configuration, conflict resolution and audit semantics, and may never be
enabled implicitly — not by an account upgrade, not by a credential that happens
to carry more scope than the feature needs. In force today: optional adapters are
read-only by default after cutover, per [native local operation](native-local.md).

**C4 — No silent substitution.** An unset, expired or failed credential leaves
the feature refusing or in dry run. It never guesses and never switches to another
provider, because a feature that keeps succeeding through a different
counterparty is unauditable.

There is exactly one permitted exception, and it is bounded: model routing may
fall back **only** on transient provider failures, **only** among measured
eligible profiles, and an explicit per-role override is never overridden by a
fallback (P-050). That is a documented retry among equals, not a substitution.

One related default is worth naming rather than hiding: an existing email policy
that omits `provider` retains Resend behaviour for compatibility. That is a
documented default rather than a substitution, but it is the one place a provider
is chosen because nothing was said. When that fallback goes is a future decision,
not this one.

**C5 — Feature parity before a default changes.** No provider becomes or stops
being the default until a versioned capability matrix records, per feature: the
native behaviour, the evidence for it, the known gaps, and whether the feature
depends on an external account or service. A richer native alternative is
acceptable only when it preserves the guarantees of the workflow it replaces.
Features may not quietly disappear in a cutover. This restates rule R3 of
ADR 0001 and adds the shape of the matrix it requires.

**C6 — Retirement preserves evidence.** A provider with live evidence is not
retired in the same milestone that introduces its replacement. The order is:
add the replacement's parity row with live-evidence criteria; prove it, or
explicitly downgrade the old row with a written rationale and owner; only then
change the default and demote the provider to an optional adapter. This is rule
R1 of ADR 0001, restated here because provider work is where it gets broken.

## Consequences

**Positive**

- The cost of adding a provider is known before the work starts: a scoped
  credential in the checklist, a refusal test, and a matrix row. Nothing else is
  negotiable, and nothing else is required.
- "Supported" becomes a claim the repository can defend. A provider that works
  but cannot be scoped stays a prototype, which is a truthful label rather than a
  hidden risk.
- Removing a provider stops being a deletion. It is an evidence transaction with
  an order and a record.

**Negative**

- Some working code is deliberately refused. A `sk_` key and a live commerce key
  would both function; the clients reject them anyway. That is the policy, not an
  oversight, and it will occasionally be inconvenient.
- C5 is only as good as the matrix. Nothing yet machine-checks its *content* —
  the parity suite enforces the matrix's row counts and status vocabulary, not
  whether a feature recorded as equivalent actually is. A drifting matrix makes
  the rule unenforceable while still looking satisfied.

**Neutral**

- The rules are provider-agnostic. Applying them to a native replacement is how
  C3's read-only default and C4's refusal behaviour came to exist.

## What this record does not decide

- Which providers make up the first supported set. That is an owner decision
  listed in [the credential checklist](v1-credential-prerequisites.md), and it
  blocks configuration, not implementation.
- Whether the capability matrix stays a table or becomes machine-readable. The
  contract is on its content, not its format.
- When the compatibility default for email policies stops being Resend.
- The API and SDK compatibility promise for Quicksilver's own callers.
- Any change to the 0.9.0/1.0.0 parity gate. Nothing here lowers it.

## Alternatives considered

**Trust account discipline instead of code.** Rejected: a checklist cannot refuse
a key. The client is the only place that can, and the failures this policy exists
to prevent — a live key pasted into a test run, an over-scoped token used because
it happened to work — are exactly the ones a document does not stop.

**Automatic fallback to keep features up.** Rejected as a general rule: it turns
an outage into a silent change of counterparty. The bounded model-routing
exception survives because it is visible, measured, transient-only and
override-aware.

**Support whatever works.** Rejected: it would make "supported" mean "compiled",
and the credential checklist exists because that definition had already produced
unscoped keys.

## Review

Re-read when adding or removing a provider, enabling a write path, or promoting a
prototype to supported. The question that matters while reading it: **can this
integration be scoped, refused, and left read-only until someone deliberately
says otherwise?**
