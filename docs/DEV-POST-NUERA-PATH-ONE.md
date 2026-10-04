---
title: "Nuera Quicksilver: an agent that reads your company through Sanity Context, and can't approve its own work"
tags: sanitychallenge, devchallenge, ai, typescript
cover_image: https://raw.githubusercontent.com/nueraresearch/project-quicksilver/main/docs/images/cover.png
---

*This is my entry for Path One of the Sanity Challenge. Code: https://github.com/nueraresearch/project-quicksilver (MIT).
Sanity project ID: `f87t11g1`. Walkthrough video: [FILL: video link]. Judge guide: [`docs/FOR-JUDGES.md`](https://github.com/nueraresearch/project-quicksilver/blob/main/docs/FOR-JUDGES.md).*

## What I built

Nuera Quicksilver is an **intent-driven company operating system** from Nuera RDL. A person states an
objective; agents work out a plan; and every action they want to take is **proposed by an agent,
authorized by a deterministic kernel, approved by a different human where it matters, and recorded in
Sanity**. The company itself, its people, agents, policies, evidence and workflows, is a structured model
in Sanity that the agents read through Sanity Context.

It is a platform, not a single screen. What is in the repository, and covered by its test suites:

- **The NQC Kernel**, plain TypeScript with no model inside. It checks capability grants, policy scope and
  supersession, evidence and a 0 to 5 risk score, then answers *allow*, *needs a human* or *block*. The
  decision lifecycle (8 states, 12 transitions) is stored as content in Sanity, and evaluation can make a
  decision stricter, never looser.
- **The Quicksilver Engine**, which scores what agents produce for grounding, tool failures, uncertainty
  and brittleness, and escalates weak or high-impact results to a person.
- **A durable runtime and host**: an idempotent run queue and worker with backpressure, leases,
  cancellation, retries and a dead-letter queue, cron and signed-webhook triggers, an encrypted secrets
  vault, structured logs and Prometheus metrics.
- **An intent layer** that turns an objective into a decision graph whose values are tagged by where they
  came from: `HUMAN_SPECIFIED`, `OBSERVED`, `AGENT_INFERRED` or `SYSTEM_CONSTRAINT`.
- **Workflows and a governed agent catalog**: a workflow builder, and versioned draft, review and publish
  for agent definitions, with its own permissions.
- **Python and Go SDK foundations**, an **Azure hosting template** (written and compiled, not yet
  deployed), and a **parity matrix** that lists every requirement with its status and, for the ones that
  can't pass yet, what they need.

![Agents propose, a kernel authorizes, a different human approves; every step is recorded in Sanity](https://raw.githubusercontent.com/nueraresearch/project-quicksilver/main/docs/images/architecture.png)

The console is how a person uses it. You talk to one chat. It reads your decisions, policies, evidence,
workflows and spend, and tells you what it found and where. When you ask for work ("cut delivery delays by a
week"), it doesn't do it. It offers a card with the request written out, which you can edit. Nothing happens
until you press the button, and pressing it runs the app's own route as you.

## How I used Sanity

**Structured content.** The company is typed documents, not a pile of pages: organization, department,
entity (people, agents and systems share one shape), capability, policy, objective, workflow, evidence,
decision and metric, plus process definitions and a catalog of agents. The schema is in
`apps/studio/schemas/`. Decisions are written back to the same dataset, with the kernel's explanation,
the evaluator's scores, and who did what and when.

**Sanity Context.** The chat assistant has no database access. Its tools are two Context MCP endpoints:
a live-dataset endpoint (`groq_query`, `schema_explorer`) and a knowledge-base endpoint
(`knowledge_base_read`). `packages/agent/src/mcp.ts` connects both and merges their tools behind a policy
check, so a tool that declares itself destructive or non-read-only is refused.

**Knowledge base.** I built a knowledge base from the `evidence` and `policy` documents (12 documents). Sanity's pipeline flags contradictions between entries; I left the seeded ones unresolved on
purpose, because a company's real evidence disagrees with itself and an agent should have to deal with that.

**Showing the work.** Under every answer there's a **What I looked at** list: each knowledge-base entry,
each GROQ query (the query text is shown), and each page of the app the assistant read. That list is the
cheapest trust feature I added. You can see in one glance whether an answer came from records or from the
model's memory.

## What it feels like to use

- **What needs you.** One list, computed from records with no model call, with one-click actions. Approve
  appears only when the card shows everything the click covers; otherwise it says "Review". If a source
  couldn't be checked, the list says so instead of showing zero.
- **Why this decision.** For any decision: the risk arithmetic, the policies that fired, and the smallest
  changes that would have changed the answer ("what would change it"), found by re-running the kernel with
  one input different. A refused plan has a **Try again with this change** button that opens the chat with
  the request filled in.
- **Safe by construction.** An approval is bound to the exact action and the policy version it was judged
  under; if either changed, the approval is refused with a 409. Whoever requested or proposed an action
  can't approve it. The chat has no approve, execute or publish tool at all.

## Things I got wrong along the way

- I first gave the chat three modes (ask, plan, work). People had to guess which one they wanted. One chat
  with cards you press was simpler and safer.
- A "needs you" list that shows zero when a data source failed to load looks like good news and is a lie.
  I made it a rule, with tests, that the list names any source it couldn't check; a silent zero is a bug.
- A near-miss feature that suggests changes is only worth having if the suggestions are the kernel's, not
  the model's. I made the kernel produce them.

## What is not proven

- No real email or webhook has been sent by this code; those adapters ship as dry runs.
- "Execute" is a simulation that records a state change and a metric.
- The Genesis, Onboard and Operate modes are the product's direction; this entry is the governed core they run on.
- Model scoring hasn't been calibrated against a live provider, and the connectors (Stripe, HubSpot,
  QuickBooks) haven't run against real accounts.
- Over 1,100 tests pass in CI, but they use fakes for the model and the Context endpoints; the live
  endpoints were verified by hand. No usability sessions with real people yet.

The full list is the [parity matrix](https://github.com/nueraresearch/project-quicksilver/blob/main/docs/platform/parity-tests.md).

## Try it

The walkthrough video (about 3 minutes) shows the full flow on the live app: **[FILL: video link]**.

The app is at https://project-quicksilver.vercel.app and signs people in through our organization's single sign-on, so it is not open to the public. The video is the demo. In it I ask the chat about our policies and open **What I looked at**, ask for work and press **Create plan** on the card it offers, read why the kernel answered as it did, and approve the decision as a different person from the one who requested it. The decision records the requester and the planner agent as proposer, and the approve route refuses both, so agents propose and a different human authorizes.

You can inspect the data yourself: the public, synthetic `demo` dataset in project `f87t11g1` has the same schema and the same evidence and policy documents as the app. The judge guide has five ready-made queries (policies, the evidence that contradicts itself, people and agents, capabilities and who may use them). The `production` dataset behind the live app is private.

---

<!--
BEFORE PUBLISHING (delete this block):
1. Fill the video link (here and in docs/FOR-JUDGES.md); check no [FILL] remains. The cover image and the diagram load from
   the repository, so check they show once the docs PR is merged.
2. Add 2 to 3 screenshots: the chat answer with "What I looked at" open, a decision with the why panel,
   and the needs-you list.
3. Confirm the public `demo` dataset answers: the query link in docs/FOR-JUDGES.md.
4. Post with the #sanitychallenge tag by October 4, 2026, 11:59 PM PDT.
-->
