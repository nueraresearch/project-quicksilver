> **Status: a published submission post, not current documentation.** This is the
> Path One post written for Nuera Quicksilver itself. It describes the entry as it
> stood when it was published. For what the platform does today, see the
> [current status](CURRENT-STATUS.md) and the [documentation index](README.md).

---
title: "Nuera Quicksilver: an agent that reads your company through Sanity Context, and can't approve its own work"
tags: sanitychallenge, devchallenge, ai, typescript
cover_image: https://raw.githubusercontent.com/nueraresearch/project-quicksilver/main/docs/images/cover.png
---

*This is my entry for Path One of the Sanity Challenge. Code: https://github.com/nueraresearch/project-quicksilver (MIT). Sanity project ID: `f87t11g1`. Judge guide: [`docs/FOR-JUDGES.md`](https://github.com/nueraresearch/project-quicksilver/blob/main/docs/FOR-JUDGES.md).*

## What I built

Nuera Quicksilver is an **intent-driven company operating system** from Nuera RDL. A person states an
objective; agents work out a plan; and every action they want to take is **proposed by an agent,
authorized by a deterministic kernel, approved by a different human where it matters, and recorded in
Sanity**. The company itself — its people, agents, policies, evidence and workflows — is a structured model
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

### You can check all of it yourself, with no credentials

```bash
git clone https://github.com/nueraresearch/project-quicksilver
cd project-quicksilver && npm install && npm run verify
```

That runs typecheck and every suite — **1,282 tests** — against fakes, with no API keys, no Sanity project
and no sign-in. I made a point of that: a claim about a governance kernel is only worth what you can
reproduce, and "trust me" is exactly the failure mode this project is about. The kernel imports no model
SDK at all, and a test fails the build if it ever starts to.

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

### The contradiction is the interesting part

Here is the actual seeded disagreement, straight out of the public `demo` dataset. Six evidence documents
form two linked pairs, and **in both pairs the higher-confidence claim is the one arguing against acting**:

| Claim | Confidence | Contradicts |
|---|---|---|
| CNC 2's controller parameter is drifting 4.7%; a 5% increase would restore spec | 0.78 | ↓ |
| The August 2025 anomaly was a **worn hydraulic seal**, not drift — fixed for $4,200 in 48h | **0.92** | ↑ back |
| Always verify simulated impact and run a controlled test before deploying | **0.95** | ↓ |
| When downtime escalates, tune aggressively and skip engineering review | 0.60 | ↑ back |

Two more documents don't contradict anything, and that is the point:

- **Maintenance Report #847** (0.85) independently reports hydraulic pressure anomalies on CNC 2 and
  *recommends investigation*. It corroborates the mechanical explanation without disagreeing with anyone,
  so it never appears in a contradiction search — and it is the second vote for "don't touch the parameter."
- **Vendor Bulletin — Firmware 4.2.1** (0.70) offers a fix for controller drift that doesn't require
  changing a production parameter at all. Nobody contradicts it, so nothing in the data points at it.

To answer *"should we adjust the controller parameter?"* an agent has to walk `contradicts[]` in **both**
directions, weigh confidence, notice the corroboration that isn't a contradiction, find the untested
alternative that isn't flagged by anyone, and then adjudicate three policies that share the scope
`production.parameter_changes` — where the **highest-priority** policy (7) says `allow` up to risk 2 and
the two below it (5 and 3) say `require-approval`.

That last one is a trap I set deliberately. The intuitive answers are "the strictest rule wins" or
"priority 7 wins and it allows this." Both are wrong, and the kernel says why in one line of its own
source: **priority can never silently loosen a restriction.** So the priority-7 `allow` does not quietly
override the two `require-approval` policies below it — the kernel still routes the action to a human.
An agent that guesses gets the wrong answer for a right-sounding reason, and a policy author cannot
launder a relaxation through a priority number.

### Could a keyword search have done this?

This is the question I kept asking, and it is the one the brief asks. For most of what Quicksilver answers,
no — and the reason is that the answers depend on relationships, not on text. A search finds the sentence
*"Engineering approval is required for parameter changes."* It does not tell you:

- whether that policy still applies, or was **superseded**, **expired**, or is **out of scope**
- whether the actor has the **capability** in the company model, or whether it is granted only to a role
  they don't hold
- whether the actor is on **this** policy's approval list
- that a **higher-priority** policy in the same scope disagrees with it
- that an `evidence` document **contradicts** the recommendation, at confidence 0.92, with `contradicts[]`
  linking the two
- how **reversible** the action is, and what the **rollback** is

None of that lives in prose. All of it is fields — `scope`, `supersedes`, `priority`, `effect`,
`confidence`, `contradicts[]`, `riskLevel`, `authorizedEntities` — so the kernel can resolve it and an agent
cannot bluff it. Strip the structure out and this is a chatbot that confabulates. Keep it and you have
something that can be held accountable.

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
- 1,282 tests pass, but they use fakes for the model and the Context endpoints; the live endpoints were
  verified by hand. No usability sessions with real people yet.

The full list is the [parity matrix](https://github.com/nueraresearch/project-quicksilver/blob/main/docs/platform/parity-tests.md).

## Try it

Live app: https://project-quicksilver.vercel.app. It signs our own people in through single sign-on, so judges use an access token instead: **`qs_mh3a1ExwuX9QYAbsgjAFve6QdXgReucf6bU3Quug8Pk`**. Open `/sign-in`, choose **Use an access token instead**, and paste it.

Several decisions are already waiting for approval — an agent asked the planner for each one, so the agent is recorded as the requester. Open one, read why the kernel answered as it did, and approve it. The approve route refuses the requester and the proposer, so a human who is neither has to authorize it, and that is you. Then download the audit trail.

The full step-by-step walkthrough, including the five ready-made GROQ queries for the public `demo` dataset, is in [`docs/FOR-JUDGES.md`](https://github.com/nueraresearch/project-quicksilver/blob/main/docs/FOR-JUDGES.md).

You can inspect the data yourself: the public, synthetic `demo` dataset in project `f87t11g1` has the same schema and the same evidence and policy documents as the app. The judge guide has five ready-made queries (policies, the evidence that contradicts itself, people and agents, capabilities and who may use them). The `production` dataset behind the live app is private.
