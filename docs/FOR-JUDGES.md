# For judges: Nuera Quicksilver (Sanity Challenge, Path One)

Nuera Quicksilver is an operating console for a company's decisions. An agent proposes work, a
deterministic kernel (plain TypeScript, no model inside) authorizes it, a different person approves it,
and every step is recorded in Sanity. The assistant in the chat answers questions about the company by
**reading it through Sanity Context**: a live dataset endpoint and a knowledge base. It cannot approve,
execute or change anything.

This page says what to look at, how to try it, and what has and has not been proven.

> Items marked **[FILL]** are for the submitter to complete before publishing; see the checklist at the
> bottom of [`DEV-POST-NUERA-PATH-ONE.md`](./DEV-POST-NUERA-PATH-ONE.md).

## Sanity information

| Field | Value |
|---|---|
| Project | `Nuera Quicksilver`, project ID **`f87t11g1`** (organization: Nuera Ag Tech) |
| Dataset | The app runs on the `production` dataset, which is **private**. Judges can inspect the public, synthetic dataset **`demo`** in the same project: [query it directly](https://f87t11g1.apicdn.sanity.io/v2024-10-01/data/query/demo?query=*%5B_type%3D%3D%22policy%22%5D). It uses the same schema and the same evidence and policy documents as production, with no personal or customer data. |
| Studio | https://project-quicksilver.sanity.studio (a Sanity login with project access is needed) |
| Context MCP, live dataset | endpoint `nuera-quicksilver-agent` (GROQ mode: `groq_query`, `schema_explorer`, `initial_context`) |
| Context MCP, knowledge base | endpoint `nuera-quicksilver-kb` over knowledge base `kbzyKoLrbQiu` (12 evidence and policy documents, read with `knowledge_base_read`) |
| Wiring | `packages/agent/src/mcp.ts` connects both endpoints and merges their tools; `packages/agent/src/assistant.ts` is the chat assistant |
| Verification | `npm run verify:mcp` exercises both endpoints against the live project (needs a Context Viewer token, which is not published) |

The endpoints and the knowledge base were created in this project on 2026-09-25 and verified then (see
[`BUILD-LOG.md`](../BUILD-LOG.md)). This project is separate from our earlier challenge entry, and the
code refuses to read that project's endpoints (`assertNotLegacyContextEndpoint`).

## Try it

- **Walkthrough video:** **[FILL: video link]** (about 3 minutes). It shows the whole flow on the live app, so you do not need to sign in to see it.
- **Live app:** https://project-quicksilver.vercel.app. Sign-in uses our organization's single sign-on, so the app is not open to the public. The video is the demo. What it shows:
  1. In the chat, a question about the company's policies, with **What I looked at** open under the answer: the sources and queries it read through Sanity Context.
  2. A request for work. The assistant offers a card, and nothing is created until the person presses **Create plan**.
  3. The decision page: why the kernel answered as it did, and what would change the answer.
  4. Approval. The decision records one person as the requester and the planner agent (`nuera-quicksilver:planner`) as the proposer, and the approve route refuses both, so a different human has to authorize it. The audit trail downloads as JSON with a digest.
- **Without credentials:** `npm install && npm run verify` runs typecheck and every suite (over 1,100
  tests) with no secrets. `npm run dev` starts the console; the pages work against a configured
  Sanity project (see [`docs/platform/sanity-isolation.md`](./platform/sanity-isolation.md)).

## What to look at, by criterion

**Meaningful use of Sanity Context and structured content.**
The company is stored as typed documents (organization, department, entity, capability, policy,
objective, workflow, evidence, decision, metric, plus process definitions and the agent catalog), schema in
`apps/studio/schemas/`. The assistant has no database access of its own: it asks the Context MCP
endpoints. Open the chat, ask *"Which policies apply to production parameter changes, and what evidence supports them?"* (use a question your seeded data can answer), then open
**What I looked at** under the answer. It lists each Sanity read (knowledge-base entry, GROQ query, with the
query text) and each page of the app it read. Nothing in that list is written to traces or evaluations; it
is for the person reading.

**Use of Knowledge Bases.**
The knowledge base is built from the `evidence` and `policy` documents, and the seeded set includes
deliberate contradictions that Sanity's own pipeline flags for review (the setup notes call them expected).
The assistant is instructed to answer from tools and to say when something is not recorded, never to fill
a gap from memory. Questions about policy and evidence are meant to go through `knowledge_base_read`;
questions about live state go through `groq_query` and the app's own routes. The sources list under each
answer shows which one was actually used.

**Technical implementation and code quality.**
- `packages/kernel`: the authorization kernel. Same inputs, same answer, no model call. `explainWhy`
  re-runs it with one input changed to say what would have changed the outcome.
- Approvals are bound to what the approver saw: an approval carries the action's fingerprint and the policy
  version, and a stale one is refused with 409. The person who requested or proposed an action cannot
  approve it (the sole operator may, with a written reason of at least 20 characters).
- The chat can offer work (plan, ask a specialist, run a workflow) only as a card the person presses; the
  model has no approve, execute or publish tool.
- Governed memory is hash-chained and advisory, with a boundary test.
- An audit trail for any decision downloads as JSON with a SHA-256 digest of the record.
- The API contract is declared in `docs/api/openapi.json` and checked against the routes by a test.

**Usability.**
- *What needs you*: one list, computed from records with no model call, with one-click actions (approve only
  when the card shows everything the click covers). A source that could not be checked says so; it never
  shows a silent zero.
- Decisions inbox with the reasoning: risk arithmetic, the policies that fired, and what would change the
  answer, with a "Try again with this change" button.
- One chat, no modes. Controls you may not use are disabled with the reason before you press them.
- Checked in Chromium at phone and desktop widths with mocked data; no task-based sessions with real
  people have been run yet.

## What has not been proven

Stated plainly, so you do not have to find it:

- No real email or webhook has been sent by this code; the approved-action adapters have only run against
  fakes and ship as dry runs.
- "Execute" in the decision loop is a simulation: it records a state change and an observed metric.
- Model scoring (WAES) has not been calibrated against a live provider, and connectors (Stripe, HubSpot,
  QuickBooks) have not been run against real accounts.
- The chat and the Sanity Context endpoints are exercised by tests with fakes in CI; the live endpoints were
  verified by hand on the dates in the build log.
- The full list, with what each item needs, is the [parity matrix](./platform/parity-tests.md).
