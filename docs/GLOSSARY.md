# Nuera Quicksilver glossary

> **System-of-record principle:** Every native Quicksilver feature — commitments, calendar, contacts, drafts, notes, reviews — lives in Quicksilver. External services (Google Calendar, email providers, Slack, CRMs, note apps) are sync targets or delivery channels. No feature requires an external credential to function.

## Action
A single executable step proposed by an agent and authorized (or rejected) by the NQC Kernel. An action is atomic, audited, and time-stamped. It lives inside a `decision` document's `candidateActions` and execution record. An action is not a task, not a commitment, and not a decision — it is what the kernel permitted to run.

> **Action vs Decision vs Commitment:** An *action* is what was executed. A *decision* is the kernel's authorization record for that execution. A *commitment* is the operator's human-level promise, which may reference a decision but is not one. These three must not be conflated in code, schema, or UI copy.

## Aura
The intent and provenance layer. Aura turns a human objective into a decision graph, identifies unknowns, asks targeted questions, and records where values came from. Aura does not grant authority.

## Agent manifest
A versioned registration describing an agent identity, supported task, and allowed impact. A manifest permits dispatch; it does not approve or execute work.

## Commitment
An operator-level promise tracked by the system. A commitment records either "I owe this" (`i-owe`) or "they owe me this" (`they-owe`), along with who, what, when, and — mandatory — why it matters. A commitment may reference a `decision` or `action` but is neither: a decision is the kernel's authorization record; a commitment is the operator's word. Status transitions (done, deferred, dropped) are human-only. Agents may propose new commitments or status changes; the kernel routes them to the operator for approval. The `counterparty` field references an in-app `contact` record — not freetext.

## Contact
An in-app record of a person or organization the operator interacts with. The `contact` Sanity document is the source of truth for counterparty identity. External contact books (Google Contacts, HubSpot, Salesforce) are sync targets — they do not own the data. Commitments and drafted communications reference contacts, not freetext names. This prevents counterparty identity from drifting across records.

## Decision graph
The structured representation of an objective, its variables, dependencies, unknowns, evidence, and proposed actions.

## Draft
A proposed outbound communication stored as a `draftedCommunication` Sanity document before it is sent. The draft is the system of record for the content — it exists and is audited regardless of whether a delivery channel (email, Slack, Discord) is configured. Sending is a governed action: proposed → kernel evaluates → human approves → delivered via the configured channel. If no channel is configured, the draft remains approved and recorded; the operator can use the content manually. External email providers and messaging services are delivery channels, not owners of the draft.

## Evaluation record
The persisted, inspectable result of Quicksilver Engine/NQC evaluation. It contains observable signals such as grounding, tool failures, uncertainty, and brittleness; it is not private model reasoning.

## Follow-up
A time-triggered resurfacing of a commitment. When a commitment's `checkBackAt` date passes, the trigger system emits an operator-queue item asking: "is this still open?" A follow-up is not a separate document — it is a durable trigger event on a `commitment`. Snoozing a follow-up updates `checkBackAt` and appends a `processHistory` entry.

## Genesis
The operating mode that starts with a mostly empty business graph and uses bounded, paid-signal experiments to discover a viable business. Spending and customer-facing actions remain governed.

## NQC Kernel
The deterministic authority layer: Nuera Quicksilver Cognitive Kernel. It checks capabilities, policies, evidence, risk, identity, approvals, workflow transitions, and tool contracts. It is the final authority for what may happen.

## Onboard
The operating mode that connects an existing business, imports observations, back-tests recommendations, runs in shadow mode, and gradually earns autonomy by department.

## Operate
The steady-state operating mode for a validated business. It optimizes, reinvests, and runs bounded experiments within the kernel's governance rules.

## Operator queue
The unified attention surface for the human operator. Assembled on demand or on a cron schedule, it answers: what needs my decision, what needs my action, what am I waiting on, and what is upcoming. It is read-only aggregation over decisions, commitments, scheduled items, and drafts. It does not grant or change any authorization state. No external service is required.

## Operator note
Freeform context or reference material attached to a commitment, decision, scheduled item, or contact. Stored as a `operatorNote` Sanity document or as an inline field on the parent record. Quicksilver is the source of truth — external note apps (Notion, Google Docs, Obsidian) are optional export targets, not the canonical store. Notes are what give commitments and decisions their "why" over time.

## Playbook
Versioned business process content that combines lifecycle stages with workflow graphs. Playbooks are data, not executable code, and every action they propose still passes through the NQC Kernel.

## Provenance
The origin of a value in the decision graph. Current tags include `HUMAN_SPECIFIED`, `OBSERVED`, `AGENT_INFERRED`, and `SYSTEM_CONSTRAINT`.

## Quicksilver Engine
The deterministic evaluation layer that scores observable properties of an agent result, including grounding, missing references, tool failures, uncertainty, and brittleness. Evaluation can make a decision stricter, never looser.

## Review
A generated, time-stamped snapshot of the operator queue. Produced by the review workflow on a cron schedule and stored as a `review` Sanity document. A review is informational only — it is not an authorization artifact and does not change kernel state. Available via `qs operator review` (CLI) and `/operator/review` (web).

## Scheduled item
A time-bound item stored in Quicksilver's in-app calendar (`scheduledItem` Sanity document). Kinds include `reminder`, `review-block`, `meeting`, `deadline`, and `check-back`. The in-app calendar is the source of truth — external calendar services (Google Calendar, iCal) are optional sync adapters on top of it. Every feature that uses scheduled items works without any external credentials. Creating or modifying a scheduled item is a governed action. Recurring items use a cron expression registered with the `CronScheduler`.

## Shadow mode
A recommendation-only mode. An agent proposes and the kernel evaluates as if autonomy had been granted, but no side effect is executed. A human supplies the verdict and the result can train Aura's predictor.

## WAES
Wellbeing-Aligned Evaluation System. The planned/reinforced review gate for offers, claims, and customer-facing messages. A failed or missing review blocks the corresponding content from shipping.

## Worker runtime
The durable run queue and worker system in `@quicksilver/kernel/runtime`. It supports admission validation, idempotency, backpressure, leases, cancellation, retries, dead letters, and memory/file/PostgreSQL stores.
