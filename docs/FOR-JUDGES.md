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

## Query the public dataset yourself

These run against the public, synthetic `demo` dataset in project `f87t11g1`, with no token. They are the same kinds of read the chat assistant makes through Sanity Context.

| Query | What it shows |
|---|---|
| [What is in the dataset](https://f87t11g1.apicdn.sanity.io/v2024-10-01/data/query/demo?query=%7B%22policies%22%3Acount%28%2A%5B_type%3D%3D%22policy%22%5D%29%2C%22evidence%22%3Acount%28%2A%5B_type%3D%3D%22evidence%22%5D%29%2C%22entities%22%3Acount%28%2A%5B_type%3D%3D%22entity%22%5D%29%2C%22capabilities%22%3Acount%28%2A%5B_type%3D%3D%22capability%22%5D%29%2C%22decisions%22%3Acount%28%2A%5B_type%3D%3D%22decision%22%5D%29%7D) | How many documents of each kind |
| [Policies, highest priority first](https://f87t11g1.apicdn.sanity.io/v2024-10-01/data/query/demo?query=%2A%5B_type%3D%3D%22policy%22%5D%7Corder%28priority%20desc%29%7Bname%2Cscope%2Cpriority%2Ceffect%2CmaxRiskLevel%7D) | The rules the kernel applies, with scope and effect |
| [Evidence that contradicts other evidence](https://f87t11g1.apicdn.sanity.io/v2024-10-01/data/query/demo?query=%2A%5B_type%3D%3D%22evidence%22%20%26%26%20count%28contradicts%29%3E0%5D%7Btitle%2Cclaim%2Cconfidence%2C%22contradicts%22%3Acontradicts%5B%5D-%3Etitle%7D) | The disagreements we seeded on purpose; an agent has to deal with them |
| [People, agents and systems](https://f87t11g1.apicdn.sanity.io/v2024-10-01/data/query/demo?query=%2A%5B_type%3D%3D%22entity%22%5D%7Corder%28entityType%20asc%29%7Bname%2CentityType%2C%22department%22%3Adepartment-%3Ename%2C%22reportsTo%22%3AreportsTo-%3Ename%7D) | One `entity` shape for all of them, with department and who they report to |
| [Capabilities and who may use them](https://f87t11g1.apicdn.sanity.io/v2024-10-01/data/query/demo?query=%2A%5B_type%3D%3D%22capability%22%5D%7Corder%28riskLevel%20desc%29%7Bname%2CriskLevel%2C%22authorized%22%3AauthorizedEntities%5B%5D-%3Ename%7D) | Risk level 0 to 5 and the entities authorized for each |

## Try it

- **Live app, with an access token:** https://project-quicksilver.vercel.app. The app signs our own people in through single sign-on, so judges use an access token instead. The token is given in the submission post on DEV; it is deliberately not stored in this repository.
  1. Open `/sign-in`, choose **Use an access token instead**, and paste the token. You are signed in as a human with the `supervisor` role.
  2. Open **Decisions**. Several are already waiting for approval. An agent entity (the Engineering Agent) asked the planner for each one, so it is recorded as the requester and the planner (`nuera-quicksilver:planner`) as the proposer.
  3. Open one and read why the kernel answered as it did, and what would change the answer. Approve it. The approve route refuses the requester and the proposer, so a human who is neither has to authorize it, which is you. Then download its audit trail (JSON, with a digest).
  4. Ask the chat about the company's policies and open **What I looked at**: the sources and queries it read through Sanity Context.

  This token cannot ask for a plan of its own (that needs a different permission), so planning is in the video. Everything you do is recorded under this token's entity, in the real deployment.
- **Walkthrough video:** **[FILL: video link]** (about 3 minutes). It shows the whole flow, including asking for a plan and the refusal when the same person tries to approve their own request.
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
