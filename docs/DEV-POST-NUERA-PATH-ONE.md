---
title: "Nuera Quicksilver: an agent that reads your company through Sanity Context, and can't approve its own work"
tags: sanitychallenge, devchallenge, ai, typescript
cover_image: [FILL: cover image URL]
---

*This is my entry for Path One of the Sanity Challenge. Code: https://github.com/nueraresearch/project-quicksilver (MIT).
Sanity project ID: `f87t11g1`. Judge guide: [`docs/FOR-JUDGES.md`](https://github.com/nueraresearch/project-quicksilver/blob/main/docs/FOR-JUDGES.md).*

## What I built

Most "AI for your business" tools answer from documents they searched. Nuera Quicksilver answers from a
**structured model of the company in Sanity**, and it keeps the agent away from the controls.

You talk to one chat. It reads your decisions, policies, evidence, workflows and spend, and tells you what
it found and where it found it. When you ask for work ("cut delivery delays by a week"), it doesn't do
it. It offers a card with the request written out, which you can edit. Nothing happens until you press the
button, and pressing it runs the app's own route as you.

The decision itself goes through a **kernel written in plain TypeScript, with no model inside**. The agent
proposes an action; the kernel checks capability, policy and risk and answers *allow*, *needs a human* or
*block*. A different person approves. Every step lands in Sanity.

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

**Knowledge base.** I built a knowledge base from the `evidence` and `policy` documents (12 documents,
11 entries). Sanity's pipeline flags contradictions between entries; I left the seeded ones unresolved on
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
- Model scoring hasn't been calibrated against a live provider, and the connectors (Stripe, HubSpot,
  QuickBooks) haven't run against real accounts.
- Over 1,100 tests pass in CI, but they use fakes for the model and the Context endpoints; the live
  endpoints were verified by hand. No usability sessions with real people yet.

The full list is the [parity matrix](https://github.com/nueraresearch/project-quicksilver/blob/main/docs/platform/parity-tests.md).

## Try it

[FILL: URL of the demo deployment]. No account is needed: open **Sign in**, press **Start as Marcus Webb**, ask the chat something and open **What I looked at**, press **Create plan** on the card it offers, then use **Switch to Sarah Chen** in the top bar to approve it. Everything in the demo is synthetic, and it runs on its own dataset and Context endpoints, separate from ours.

---

<!--
BEFORE PUBLISHING (delete this block):
1. Live URL: deploy the judge demo (docs/platform/judge-demo.md), check it with the five steps in section 5
   of that runbook, and put its URL here and in docs/FOR-JUDGES.md. Run `npm run demo:reset -- --confirm` first.
2. Judge-readable data: the public dataset is `demo` (synthetic). Give its query URL in docs/FOR-JUDGES.md.
   Production stays private; never make it public.
3. Confirm the Context endpoints and knowledge base still answer (npm run verify:mcp) and that the
   example question in docs/FOR-JUDGES.md matches your seeded data.
4. Check every [FILL] and the repo URL (README links nuerainc/project-quicksilver; this repo is at
   nueraresearch/project-quicksilver).
5. Add 2 to 3 screenshots: the chat answer with "What I looked at" open, a decision with the why panel,
   and the needs-you list.
6. Post with the #sanitychallenge tag by October 4, 2026, 11:59 PM PDT.
-->
