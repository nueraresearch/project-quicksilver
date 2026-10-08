# Current project status

**Snapshot date:** 2026-10-07
**Repository baseline:** `74f1e4a` — merge of [PR #92](https://github.com/nueraresearch/project-quicksilver/pull/92)

This is a concise operational and implementation snapshot. It separates code that
exists from live evidence that has been collected, so it must not be read as a
1.0.0 readiness claim.

## Where each piece runs

Three different targets appear in this repository's documentation. They are
different layers, not successive attempts at one thing.

| Layer | Target | What runs there | Status |
|---|---|---|---|
| Web console and API routes | **Vercel** — `https://project-quicksilver.vercel.app` | `apps/web`, the Next.js console and its governed API routes | Live; deployed by the Vercel GitHub App on every PR |
| Hosted runtime | **Render** — single-tenant host service | `packages/host`: worker pool, schedules, signed webhooks, management API, vault | Health, readiness, and persistence wiring validated 2026-10-05/06 |
| Host, alternative | **Azure** — not provisioned | `deploy/azure/main.bicep`, the container host option | Documented and compiler-checked; **never applied to a subscription** |

The Vercel and Render deployments are independent services that share this
repository, not two names for one deployment. Azure is a third option that is
written down but not standing up; see
[Azure: the host and the services behind it](platform/azure-deploy.md).

## About the snapshot header

The `Snapshot date` and `Repository baseline` above describe when this page was
last reconciled by hand, not the current state of `main`. For the live status,
read the repository's GitHub Actions page and the open pull requests. This page
records the semantic difference between built and proven; the commit it was
reconciled against is a bookkeeping detail that goes stale on its own.

## Confirmed complete or built

| Area | Current evidence | Classification |
|---|---|---|
| M1–M7 governance foundation | Kernel governance, durable runs, triggers, host process, Aura intent layer, Genesis/Onboard/Operate foundations, and the M7 acceptance matrix are implemented. | **Implementation complete through 0.8.0**; see [M7 release evidence](platform/m7-release-evidence.md). |
| Single-tenant hosted runtime | The host has a Render deployment with PostgreSQL for runs and a mounted `/data` disk for auxiliary state. Health, readiness, and persistence wiring were inspected on 2026-10-05/06. | **Operationally validated in a narrow scope**; see [Render operational evidence](platform/render-operational-evidence-2026-10-05.md). |
| Render Genesis persistence | PR #88 adds `QUICKSILVER_GENESIS_DIR=/data/genesis`, regression coverage, and portable workflow configuration. | **Merged implementation**; live post-merge verification is still pending. |
| Governed agent profiles and host memory API | PR #92 adds web-profile bindings for planner/reviewer/query/specialist routes, reviewed skill/routine/context loading, optional isolated agent memory, and authenticated governed host-memory routes. | **Merged and regression-tested; P-017/P-018 remain partial** for production-owned resources, operational model evidence, full-text recall, unified preferences, and shared multi-tenant storage. See [agent profiles](platform/agent-profiles.md) and the [parity matrix](platform/parity-tests.md). |
| Browser OIDC sign-in and sessions | Authorization-code/PKCE, signed ID-token validation, tenant-scoped durable sessions, role mapping, revocation, route guards, sign-in/sign-out controls, and account pages are implemented. Live Google allowlist/refusal and sign-in evidence was recorded on 2026-10-03; session persistence across production redeploys is now recorded. | **P-108 covered**; persistent principal/role administration and integrated multi-tenant hosting remain open. See [SSO setup](platform/sso-setup.md) and the [parity matrix](platform/parity-tests.md). |
| Intent and operating-mode foundations | Aura's provenance-tagged intent graph and ledger, the Onboard shadow-mode playbook, Genesis budget/ledger controls, and the Operate reinvestment foundation are implemented. | **Built, not operationally complete**; pilots and real-account evidence remain. |

## Not complete or not yet proven

- **PR #92 test checks passed at merge.** The project owner confirmed the merge completed without test failures on 2026-10-06. This is a point-in-time CI result, not evidence of live business-provider execution or 1.0.0 readiness; check GitHub Actions for the status of later commits.
- **Live post-PR #88 verification is pending.** The Render evidence predates the Genesis-persistence merge; confirm the new startup persistence signal and absence of the Genesis in-memory warning without writing business data.
- **No real effectful provider workflow is proven.** Email, payment, webhook, and connector paths remain dry-run, fake-provider, or record-only boundaries. No real email or webhook has been sent by this code.
- **The three operating modes lack their required operational evidence.** The Onboard pilot, Genesis run, and Operate period have not occurred; they are not release-complete merely because their foundations are implemented.
- **Enterprise gaps remain.** A fully integrated multi-tenant control plane, stable/published SDK contracts, complete Supervisor Agent, isolated effectful execution, full traces/cost operations, marketplace/domain packs, and compliance evidence are M8–M9 work.
- **Persistent identity administration remains open.** Principal and role administration still needs durable management workflows and audit controls; the P-108 sign-in/session path is covered.

## Highest-value near-term work

1. **Run a narrow Render post-deploy check.** Confirm `/healthz`, `/readyz`, and the selected persistence backends after PR #88. Keep it read-only unless a separately approved recovery/test plan calls for a sentinel write and restart.
2. **Define principal/role administration.** Decide and implement the durable, audited management path; do not treat the completed P-108 sign-in experience as covering administrative lifecycle needs.
3. **Prepare, do not start, the pilots.** The next large evidence gaps are organizational rather than coding tasks: entity/payment-account decisions for Genesis and the scheduled Onboard shadow-mode pilot.
4. **Keep P-017/P-018 operational work explicit.** Production-owned profile resources, live model runs, trusted request-derived tenant identity, shared memory coordination, and complete recall remain open; see the parity matrix.

## Version numbering

`package.json` currently reads `0.4.0` across the workspace packages, while this
page refers to 0.8.0 implementation-complete and the [parity matrix](platform/parity-tests.md)
frames 0.9.0 and 1.0.0 gates. These are two different things and the divergence is
intentional for now: the manifest version is a placeholder that does not track the
release gates. Use the parity matrix, not `package.json`, to judge where the
project actually is. The manifest will be brought into line when releases are cut.

## Source of truth

- [Implementation roadmap](NUERA-QUICKSILVER-ROADMAP.md)
- [Blueprint coverage](NUERA-QUICKSILVER-SPEC-COVERAGE.md)
- [Parity test matrix](platform/parity-tests.md)
- [M8–M9 enterprise plan](M8-M9-ENTERPRISE-PLAN.md)

The linked documents define the detailed feature and release criteria. This page
is the maintained entry point for the current done/not-done distinction.
