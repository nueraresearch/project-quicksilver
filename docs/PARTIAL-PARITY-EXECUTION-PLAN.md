# Partial parity execution program

**Status:** active implementation plan  
**Branch:** `feat/partial-parity-program`  
**Scope decision:** implement every remaining partial/Aura item from the product-owner-approved P-001–P-123 baseline, except P-108, P-114, P-117, P-118, P-122, and P-123, which are explicitly deferred for a later pass.

This is a delivery program, not a claim that the rows are complete. A row closes only when its implementation, regression evidence, runtime integration, and required operational evidence are recorded in `docs/platform/parity-tests.md`.

## Workstreams

### Wave 1 — governed cognitive/runtime foundations

| P-items | Deliverables | Exit evidence |
|---|---|---|
| P-017, P-018, P-019 | Per-agent profile bindings for memory/skills/routines/context; authenticated memory management surface; source-decision validation; reviewed portable `SKILL.md` lifecycle; outcome scoring and prompt injection with provenance. | Kernel/agent/host tests, tenant-bound API tests, migration notes, redacted sample run. |
| P-020, P-021 | Business/event trigger adapters; durable unattended automation runner; isolated subagent workspaces and bounded batch/delegation model; department unit-economics hooks. | Scheduler/replay/backpressure tests, isolation tests, failure/pause evidence, documented limits. |
| P-045, P-050 | WAES live-provider calibration path and evidence format; persistent model-profile outcome history with fail-closed routing and rollback. | Calibration fixtures plus live-provider run record; routing-history regression and audit tests. |

### Wave 2 — integrations and effectful runtime

| P-items | Deliverables | Exit evidence |
|---|---|---|
| P-022, P-024, P-028 | Channel expansion and WAES customer-facing gate; governed source-page retrieval and durable research reports; app/catalog and office integration contracts. | Adapter contract tests, credential-safe failures, connector/source evidence. |
| P-025, P-026 | Real media provider adapter and durable media store; Azure deployment adapter, custom-domain/release lifecycle, hosted experiment teardown. | Provider fakes plus one live provider/deployment run, cost/provenance records. |
| P-027, P-095 | Orders/refunds/live commerce controls; durable pending queues; live Sanity mutation and approved-action executor adapters. | Idempotency/replay tests, approval-bound effect tests, no-money-transfer safety proof, dated live evidence where authorized. |
| P-071, P-088, P-107 | Accounting-period attribution and department evidence; vault-backed real Stripe/HubSpot/QuickBooks connector runs; integrated multi-tenant host provisioning/schedules/workflows. | Cross-tenant integration suite, migration handling, real connector run records, operational runbook. |

### Wave 3 — platform breadth and research

| P-items | Deliverables | Exit evidence |
|---|---|---|
| P-023, P-029, P-030 | Always-on workspace and per-venture isolation; provider data-use decisions and governance evidence; desktop/streaming/interface expansion and autonomy-mode contract. | Workspace isolation tests, signed provider policy records, interface contract tests. |
| P-031 | General batch-run service, bounded trajectory export, privacy review, and reviewed Genesis prior-import path. | Batch cancellation/resource tests, export redaction tests, human review/audit evidence. |
| P-064, P-065, P-066 | Fresh Aura held-out evaluation, frozen-method choice agreement, and real-use question-quality measurement. | Dated independent datasets, methodology/version hashes, pilot results. |
| P-109 | Upgrade/retire the accepted web/Studio runtime advisories and re-run dependency review. | Clean runtime-path audit plus documented residual decisions. |

## Sequencing constraints

1. **No live provider or external side effect is enabled by code alone.** Credentials, tenant ownership, provider terms, deployment billing, and human approvals remain explicit prerequisites.
2. P-088 must precede the Onboard pilot and any claim that live connector behavior is operational.
3. P-095 must remain fail-closed and dry-run by default; real mutations require a separate approved-action evidence record.
4. P-107 uses Postgres for shared multi-tenant storage; file stores remain single-host/single-writer unless their ownership boundary is explicit.
5. P-064–P-066 are Aura charter evidence and do not gate Quicksilver release acceptance, but they remain in this requested work program.
6. Deferred for the next pass: **P-108, P-114, P-117, P-118, P-122, P-123**.

## Current implementation checkpoint

- Existing code already provides substantial foundations for skills, automations, web search/deep research, media contracts, hosting contracts, commerce proposals, live connector readers, approved actions, tenant-scoped stores, OIDC, telemetry, CLI parity, API contracts, and responsive/usability checks.
- The next code tranche should therefore prioritize the missing seams rather than duplicate existing foundations: authenticated memory APIs, agent profile bindings, durable automation execution, persistent routing history, source retrieval/report storage, live-provider adapters, and multi-tenant hosted orchestration.
- Every completed tranche must update the relevant parity row with exact test names and dated operational evidence; implementation alone does not close a row.
