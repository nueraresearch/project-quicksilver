# Sanity platform plan

Nuera Quicksilver uses Sanity deeply as a **document store** — 32 schema types, GROQ
behind API routes, a Studio, two datasets, Context MCP. That is a database wearing a
CMS's clothes. The challenge entry is *Path One: Ship an Agent That Queries Real
Content*, where Sanity's **platform** — not just its storage — is the thing being
judged.

This plan covers five gaps, in dependency order. Each states what changes, what it
risks, and how we know it worked.

## Current state (verified, not assumed)

| Capability | Status |
|---|---|
| `@sanity/client` v6, `sanity` v5 Studio | in use |
| `structureTool` | in use |
| `sanity-plugin-workflow` (decision kanban) | in use, and the config notes **nothing in the app reads those states** |
| GROQ | in use, but **every query is a raw string** — zero `groq` tag imports |
| Content read path | server-side behind `/api/*`, `no-store`; the console is client-rendered |
| `presentationTool` / `VisualEditing` / `defineLive` | **absent** |
| `@sanity/vision` | **absent** |
| `next-sanity` | **not installed** |
| Sanity Functions (event-driven) | **absent** |

## The three constraints on item 1, and how each is actually solved

None of these is a wall. All three have supported solutions; they are listed here
because each one is silent when it goes wrong.

**A. Stega encoding, and the kernel's deterministic comparison.** Visual Editing
embeds invisible zero-width characters into returned strings, so a stega-encoded
`"approved"` does not equal `"approved"` — and the failure is silent, an approval
that simply does not match.

Three layers of mitigation, strongest last:

1. `sanityFetch` takes `stega` **per query** (documented: `stega: false` for
   metadata and anything logic-bearing), so this is a call-site decision, not a
   global one.
2. **Projection-level boundary** — the tightest form. The editorial query projects
   only the strings meant to be displayed (`title`, `body`, `description`). Status,
   identifiers, digests and tokens never enter the stega'd payload, so there is
   nothing to clean. This is stronger than running two clients, because it holds even
   if someone later adds a field to the wrong query.
3. `stegaClean()` at any boundary that must not see encoded strings.

And the structural guarantee underneath all three: **stega is only applied when Draft
Mode is active.** The kernel does not run in Draft Mode, so the governance path is
unaffected by construction, not by discipline.

**B. The T-67 CSP.** `<VisualEditing />` and `<SanityLive />` are React components,
and Next.js stamps the response nonce onto any script it renders. The thing that
would break under a strict nonce policy is the *alternative* `@sanity/react-loader`
script-tag approach, which injects a raw tag outside React's control. The App Router
path already prescribes components. So the expectation is that this works; the spike
confirms it rather than discovering a wall.

**C. `defineLive`'s `browserToken`.** The token is only needed to deliver *draft*
content, which means **draft mode is a preview-environment concern**:

- scope Visual Editing to **preview deployments**. Production never enters Draft
  Mode, so it needs no token and gains no new exposure — the current `no-store` API
  path stays exactly as it is.
- point it at the **public `demo` dataset**, where a Viewer token is close to free:
  that dataset is already publicly queryable with no token at all. The genuinely
  sensitive surface is the private `production` dataset, and it stays server-side.

Together these mean the browser token is a **read-only token against content that is
already public**. The threat-model entry is still required, but the change to A-3 is
much smaller than a first reading suggests.

**Spike (half a day, to confirm rather than to discover):** render both components as
components, confirm the T-67 CSP permits them without relaxation, and confirm a
stega-enabled editorial fetch and a clean kernel fetch coexist. If the CSP genuinely
blocks it, the answer is still **not** to weaken `script-src` — keep the strict policy
and drop item 1. A judge will not ding a missing overlay; a judge *will* read a
weakened CSP.

## Item 1 — Visual Editing and live content

**Why it is the top item.** It is the one change that makes the Sanity relationship
self-evident in thirty seconds without a word of explanation: open the app, click any
string, edit it in place, watch it update live. Everything else in this plan is
invisible to a judge.

**Scope, deliberately narrow.** Visual Editing applies to the *editorial* document
class only:

- in scope: `objective`, `policy`, `playbook`, `entity`, `capability`,
  `contentReview`, `agentDefinition`, `department`, `organization`
- **out of scope, permanently**: `decision`, `evaluationRecord`,
  `authorizationDecisionAudit`, `departmentExecutionAudit`, `workflowExecution`,
  `telemetryTraceSpan`, `oidcWebSession`, `oidcLoginTransaction`

That boundary is not timidity. A decision is created by the kernel under an
authorization bound to a fingerprint; letting an editor drag one into "executed" from
a web page would hollow out the product's central claim. The line "editors shape
content; the kernel moves decisions" is a *feature* a judge can be told about.

**Work:** add `next-sanity`; `defineLive` in a `lib/sanity/live.ts`; `<SanityLive />`
and draft-mode-conditional `<VisualEditing />` in the root layout;
`defineEnableDraftMode` route; `stega: { studioUrl }` on the editorial client only;
`presentationTool` in `sanity.config.ts` with `previewUrl`; CORS for the frontend
origin with credentials; a Viewer token in the threat model.

**Done when:** an editor clicks a policy title in the running app, edits it, and the
change appears without a reload — and the decision list is provably unaffected by
stega (covered by a test).

## Item 2 — Sanity Functions

**Why.** 32 schema types and no automation on content change. This is the one item
that makes the *governance* thesis native to Sanity rather than bolted beside it.

**Work.** Functions on create/update/delete for the editorial types:
- new `evidence` → enqueue an Aura evaluation through the existing governed path
- `policy` change → identify decisions whose evaluation predates it and flag them
- `objective` change → re-derive the affected intent graph

**The rule that must not be broken:** a Function may *request*; it may not *decide*.
Anything with a consequence routes through the kernel and the existing approval path,
exactly as an HTTP caller would. A Function is an untrusted caller with a convenient
trigger, and the plan should say so in the code comment that a reviewer will read.

**Done when:** a content edit produces a governed follow-up record, and the audit
shows it arriving through the normal authorization path.

## Item 3 — GROQ Vision

**Why.** One dependency, one line in `sanity.config.ts`, and it hands a judge a GROQ
playground pre-loaded with your real queries. For an entry whose path is *querying
real content*, letting them watch the query and then see it drive the app is the
cheapest credibility available.

**Work:** add `@sanity/vision`, register `visionTool()` beside `structureTool()`.

**Done when:** Studio opens a Vision pane that runs against both datasets.

**Do this first.** It is the cheapest item on the list and it proves the Studio
toolchain works before the larger items depend on it.

## Item 4 — Type-safe GROQ

**Why.** With 32 schema types, raw query strings break at runtime when a field is
renamed. `groq`-tagged queries type-check against the schema, so the compiler finds
it. It is also a code-quality signal a judge reads directly.

**Blast radius, measured.** 124 matches across 41 files, but the real query
concentration is small:

- `web/lib/agent-catalog-store.ts` (14), `web/lib/workflow-publication-store.ts` (11)
- `web/app/api/dashboard/overview/route.ts` (9), `web/app/api/decisions/route.ts` (9),
  `web/app/api/dashboard/finance/route.ts` (5)
- `studio/scripts/smoke-test.ts` (14), `studio/scripts/reset-history.ts` (6)

Roughly ten files carry the queries. The rest are single `fetch()` calls.

**Order matters:** this lands *before* item 1, because it is what reveals which
queries feed the UI versus background jobs — the editorial/system split that item 1
depends on.

**Done when:** no GROQ literal remains untagged, and a deliberate field rename
produces a type error rather than a runtime null.

## Item 5 — Deepen the public demo dataset

**Why.** The `demo` dataset is already public and queryable without a token, which is
genuinely strong. But Path One rewards *real content*, and the value scales with
depth. A judge who can run their own query against a dataset with a real
contradiction in it gets a different impression than one who finds twelve tidy
documents.

**Existing asset worth building on:** `npm run demo:seed-decisions` does not fake
anything — it drives the live app so the planner agent produces genuine decisions
that the kernel checks and a human approves. The depth problem is therefore about
*inputs and outcomes*, not about manufacturing records.

**Work:** widen `DEMO_OBJECTIVES` in `apps/studio/seed/demo-objectives.ts` toward
objectives whose answers disagree; ensure the seeded company carries enough entity,
metric and money-entry history that an agent's answer is visibly grounded in it;
make the contradiction a deliberate, documented feature of the demo rather than an
accident.

**Done when:** a judge can run one GROQ query against the public dataset and get an
answer that makes the agent's reasoning legible without reading the code.

## Sequencing

| Order | Item | Why here |
|---|---|---|
| 1 | **#3 Vision** | cheapest; proves the Studio toolchain |
| 2 | **#5 demo depth** | nothing else is demonstrable on a thin dataset |
| 3 | **#4 typed GROQ** | reveals the editorial/system split item 1 needs |
| 4 | **#1 Visual Editing** | after the spike clears CSP and stega |
| 5 | **#2 Functions** | independent; can run parallel to 1–4 |

**Stretch, if time allows:** wire `sanity-plugin-workflow` transitions into the audit
trail. Today a reviewer drags a card on a kanban that the running app cannot see, and
the config says so plainly. Closing that loop turns a Studio-only feature into a
governed one.

## What is deliberately not recommended

- **Do not relax the CSP.** If Visual Editing cannot run under T-67, drop it.
- **Do not put stega on kernel-facing stores.** Item 1A is a boundary, not a setting.
- **Do not Visual-Edit governance records.** The editorial split is the product.
