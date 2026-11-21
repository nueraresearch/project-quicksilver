# ADR 0005 recommendation memo: which gate decides when Sanity may become optional

- **Status:** Superseded by [ADR 0006](adr-0006-content-parity-first-gate.md) on 2026-11-21. The Product Owner chose the content-first sequence this memo argued against, and ADR 0006 answers the objection it raised; the memo is kept as the comparison record, not as current guidance. Nothing here changes a provider status, edits `core` flags, runs an export, touches production, or authorizes migration.
- **Date:** 2026-11-21
- **Decision under review:** [ADR 0005 — Sanity demotion and the global removal gate](adr-0005-sanity-demotion-global-gate.md) (Proposed, D1–D5)
- **Inputs:** [native capability matrix](native-capabilities.json) v1, [CMS cutover plan](native-cms-cutover.md) §2/§7, [C0 unblock packet](native-cms-c0-unblock-packet.md), [C1 acceptance report](native-cms-c1-evidence/c1-acceptance-report.md), [ADR 0001](adr-0001-native-first-ownership.md) R1/R3, [ADR 0003](adr-0003-native-local-operation.md) L2
- **Measured at:** `7a62323` (the five open PRs merged), `npm run native:gate` → exit 1

## 1. Recommendation

**Accept ADR 0005 D1–D4: keep the removal gate global at 23 core rows.** Reject the 14-content-row alternative, and reject it for a reason that is stronger than the ADR's own: the content-only gate cannot be satisfied on its own terms.

The decisive row is `content.credential-free-startup`. It is marked native only when a clean install serves content with every `SANITY_*` variable **absent** — but every data-backed route needs a principal, and the only sign-in today is Google OIDC (`identity.oidc-signin`, `identity.session-store`, `identity.local-enrollment` all `absent`). A content-only gate therefore has exactly two exits:

1. carve out `content.credential-free-startup` — at which point the gate proves "Sanity is optional" without ever demonstrating an install that works, which is the claim in name only that ADR 0005 D4 already rejects; or
2. wait for local identity — at which point the gate is the global gate minus email and inference, and the schedule has the same longest pole.

Both exits are worse than accepting the rule as written. The rest of this memo is the comparison that supports that conclusion, and two amendments that address the global gate's real cost.

## 2. What the two gates actually decide

`npm run native:gate` exits 0 only when every row with `core: true` is `native`, has `externalRequired: false`, and carries registered evidence. The question in ADR 0005 is which rows that sentence covers.

| | Rows | native | partial | absent |
|---|---:|---:|---:|---:|
| `content.*` | 14 | 0 | 5 | 9 |
| non-content core | 9 | 1 | 1 | 7 |
| **total core** | **23** | **1** | **6** | **16** |

The 5 partial content rows: `ontology`, `query.tenant`, `migration-rehearsal`, `api-response-contract`, `tenant-isolation`. The 9 absent: `decisions`, `agent-catalog`, `workflow-publication`, `chat-inbox`, `studio-admin`, `seed-fixtures`, `context-retrieval`, `backup-restore`, `credential-free-startup`.

The 9 non-content rows: `inference.local-planning` (**native**), `inference.local-install` (absent), `identity.oidc-signin`, `identity.local-enrollment`, `identity.session-store` (all absent), `email.smtp-submission` (partial), `email.starttls`, `email.inbound`, `email.live-delivery` (absent).

Both options require all 14 content rows everywhere below; they differ only in whether the other nine are on the path to `providers[].sanity.status = optional`.

## 3. Option A — a 14-content-row gate

### 3.1 What must become true

- All 14 content rows `native` with the negative cases in [cutover §4](native-cms-cutover.md).
- Two governance edits, not one: **supersede ADR 0003 L2** (which already says *every* core feature must work on a clean install before Sanity stops being required), and **redefine or carve out `content.credential-free-startup`**, which by its own text may only be marked native after every other core row is.

That second obligation is the row that makes the claim mean something. Removing it leaves a gate that certifies a migration no unauthenticated install can exercise.

### 3.2 Critical path

Sequential, with the stages that already have design work first:

```
C0 blockers ──▶ C1 exit ──▶ C2 routes ──▶ C3 admin/seed/context ──▶ C4 isolation+backup
   (4 paper)      (4 items)    (51 ops)        (studio parity)          (drills)
        │
        └──▶ C5 real-export rehearsal ──▶ C6 canary (7d shadow + 14d writes) ──▶ C7 demotion
```

`C4` contains the terminal row, and the terminal row needs a local principal. So the honest Option A path is this chain **plus** whatever supplies a first owner — which is stage 4 of [native-local.md](native-local.md), i.e. the identity rows that Option A claims to leave out.

### 3.3 Remaining evidence

| Stage | Evidence still missing |
|---|---|
| C0 | Read-only baseline export with manifests and digests; signed ownership manifest (zero unresolved); C0 scope signature; C1 entry bundle. Two of six decisions are recorded (`playbook` retained 2026-11-19; chassis = direct native repositories 2026-11-19). |
| C1 | Production persistence adapter; production export with project/dataset/counts/digests; entry-bundle signatures; redaction review; owner sign-off. The 50/50 matrix and 53 tests are green **on the in-memory fixture store only**, and the report says so in its first line. |
| C2 | Every retained route on native repositories; 51/51 operations validated against seeded native data (today 37/51; the other 14 are 8 × 500, 5 × 503, 1 × 401); per-route auth and tenant-refusal tests; soft-delete 404 / purge 410 behavior. |
| C3 | Native admin covering every retained Studio workflow; deterministic clean-install seed; context assembly citing resolvable native IDs and refusing fabricated or cross-tenant ones; Context MCP off the core path. |
| C4 | Two-tenant isolation with colliding IDs across collections, relations, queries, admin and tombstones; backup/restore drill preserving decisions, approvals, audit chains and tombstones; credential-free startup proving the variables are **absent**, not empty. |
| C5 | A real read-only production export; content comparison at zero missing/extra/changed; the asset gate (§5.5); the deletion-evidence ledger (§5.6); snapshot verify and restore; reverse migration; timed R2 drill (RPO 0 committed writes, RTO 4h). |
| C6 | 7 consecutive days read shadow; 14 consecutive days of real native writes; zero unresolved divergence; P-121 on the native path; Rollback Authority signature. |
| C7 | The 10 conditions in §7 minus the global one, plus a matrix version bump, `providers[].sanity.status = optional`, read-only adapter default, 30-day retention. |

### 3.4 Cost and risk

**Benefit:** Sanity could stop being required once the content chain finishes, without waiting on identity, inference installation or inbound email.

**Cost:** it supersedes ADR 0003 L2 to buy a claim the product cannot demonstrate — "content works without a CMS" is untestable while every route needs Google. It also creates a durable wording hazard: the matrix and CURRENT-STATUS would say "Sanity optional" beside "local install requires an identity provider", which is exactly the drift D4 was written to prevent.

**Second-order cost:** holding the content work while identity lands is not free either — the C5 export evidence is point-in-time. A cutover held for months must re-run its comparison anyway (see amendment A3).

## 4. Option B — the 23-row global gate (ADR 0005 as written)

### 4.1 What must become true

- All 23 core rows native, `externalRequired: false`, with registered evidence, at the matrix version in force — plus the ten conditions in [cutover §7](native-cms-cutover.md).
- No governance edit: ADR 0003 L2 already says this, and `content.credential-free-startup` becomes coherent instead of self-referential.

### 4.2 Critical path

Three chains that can run in parallel and join once:

```
content chain   C0 ▶ C1 ▶ C2 ▶ C3 ▶ C4 ▶ C5 ▶ C6 ─┐
identity chain  enrollment ▶ keys/rotation/recovery ▶ session store ─┤▶ gate ▶ C7
comms+model     model install ── STARTTLS ── inbound ── live delivery ─┘
```

**Longest pole:** the identity chain. It is the only chain with zero rows started and no design document equivalent to the C0/C1 set, and it carries the crypto and recovery surface (local signing/encryption keys, rotation, recovery, revocation). The email chain is smaller — `smtp-submission` already exists for implicit TLS 465 with AUTH PLAIN — and `inference.local-install` is bounded work (hardware detection, pinned runtime, checksum-verified download, resume, health surface).

### 4.3 Remaining evidence for the nine non-content rows

| Row | Status | What is missing |
|---|---|---|
| `inference.local-planning` | native | — (the only passing core row) |
| `inference.local-install` | absent | Hardware detection; pinned local runtime; checksum-verified model download; interrupted-download recovery; model health surface; refusals for insufficient resources and invalid artifacts. |
| `identity.oidc-signin` | absent | Product-owned sign-in. P-108 is live and covered, but it is Google's account, not a local credential. |
| `identity.local-enrollment` | absent | First-owner enrollment; local signing/encryption keys; rotation, recovery, revocation. |
| `identity.session-store` | absent | Native session storage and a local revocation path independent of the OIDC flow. |
| `email.smtp-submission` | partial | STARTTLS (587), OAuth-only accounts, attachments, IMAP, inbound, operator-channel wiring; a live mailbox submission record. |
| `email.starttls` | absent | Port 587 STARTTLS; explicit refusal retained for anything weaker. |
| `email.inbound` | absent | IMAP/POP3 polling, MIME parsing, thread handling, inbound identity that is not approval authority. |
| `email.live-delivery` | absent | One real native send to a real mailbox. The only live send on record is Resend (P-095). |

### 4.4 Cost and risk

**Benefit:** one claim, one gate, one evidence package; no ADR 0003 edit; no carve-out; the product can say "no mandatory third-party account" and mean it.

**Cost:** C7 waits on 8 non-native rows across three workstreams, two of which have no design work started. A single global exit also gives no intermediate release signal — the gate is binary, so months of progress read as "still blocked".

Those costs are real but they are scheduling problems, not correctness problems. They are addressed by the amendments rather than by narrowing the gate.

## 5. Comparison

| | Option A — 14 rows | Option B — 23 rows |
|---|---|---|
| What it certifies | Sanity can be optional for content | No mandatory third-party account for core operation |
| Governance | Supersedes ADR 0003 L2; carve-out of `credential-free-startup` | None; consistent with existing rules |
| Achievable as stated | Only after local identity exists, or by weakening the terminal row | Yes |
| Critical path | Content chain + whatever provides a first owner | max(content, identity, comms+model) |
| Longest pole | Content C5/C6 (evidence), then identity anyway | Identity (0 rows started, no design set) |
| Evidence still missing | 4 C0 items, 4 C1 items, C2–C6 gates | The same, plus 8 non-content rows |
| Earliest provider change | Sanity only | Sanity, OIDC, Resend, hosted model, in one package |
| Main risk | Demoting on a claim the install cannot demonstrate | C7 stalls behind unstarted work; export evidence ages |

No calendar estimate is offered for either path. The repository has no velocity data for the identity or email chains, and inventing one would be the same defect as a green gate over an empty report.

## 6. Recommendation, with two amendments

**Adopt D1–D4.** Keep the gate global; reject the 14-row exception; leave `providers[].sanity.status` and every `core` flag untouched until the gate passes.

Add two things the ADR does not currently require, because they address the only genuine weakness of Option B — that a binary global gate hides progress and lets evidence go stale:

- **A1 — Name the three chains as parallel, owner-assigned workstreams.** Content (C0→C6), identity (enrollment → keys → session store), and comms+model (`local-install`, STARTTLS, inbound, live delivery). Each chain gets its own evidence package as it completes, so the final gate is an assembly step rather than a research step.
- **A2 — Put a freshness window on export evidence.** C5's parity proof is a property of a moment. Require the content comparison, asset manifest and deletion ledger to be re-run within 14 days of the demotion decision, and record the two dates. Without this, a gate that waits months can pass on a comparison that no longer describes the dataset.

Optional, and cheap: **A3 — say in CURRENT-STATUS what each stage makes claimable.** Right now the only two states the page can express are "required" and "optional". A per-chain line ("content: fixture-green; identity: not started") costs one table row and removes the incentive to demote early just to show movement.

**What this memo does not do:** it does not accept ADR 0005, change a provider status, flip a `core` flag, run an export, or authorize any stage. Acceptance is the owner's, and D5 still requires the full evidence package after the gate passes.

## 7. What would change this recommendation

- **A product decision that partial local operation is acceptable**, i.e. that "content works locally, sign-in still needs Google" is a claim worth shipping. That requires superseding ADR 0003 L2 in a new ADR, as D4 sets out, plus an explicit answer to what `credential-free-startup` then means.
- **Local identity landing first.** If enrollment and a local session store exist, the content-only gate becomes coherent — the terminal row becomes testable — and the earlier demotion is worth re-arguing on its merits.
- **Evidence that a clean install can exercise content without a product principal** (a supported local operator account distinct from product sign-in). That would make the narrowed gate demonstrable rather than nominal.

## 8. Sign-off

| Role | Decision | Date |
|---|---|---|
| Product Owner (Nuera RDL) | Accept D1–D4 / reject / supersede with a new ADR | |
| Technical lead | Confirm the matrix numbers in §2 at the matrix version used | |
| Security | Confirm the identity row analysis in §3.4 is not overstated | |
