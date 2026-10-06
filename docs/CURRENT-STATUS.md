# Current project status

**Snapshot date:** 2026-10-06
**Repository baseline:** `5da1798` — merge of [PR #88](https://github.com/nueraresearch/project-quicksilver/pull/88)

This is a concise operational and implementation snapshot. It separates code that
exists from live evidence that has been collected, so it must not be read as a
1.0.0 readiness claim.

## Confirmed complete or built

| Area | Current evidence | Classification |
|---|---|---|
| M1–M7 governance foundation | Kernel governance, durable runs, triggers, host process, Aura intent layer, Genesis/Onboard/Operate foundations, and the M7 acceptance matrix are implemented. | **Implementation complete through 0.8.0**; see [M7 release evidence](platform/m7-release-evidence.md). |
| Single-tenant hosted runtime | The host has a Render deployment with PostgreSQL for runs and a mounted `/data` disk for auxiliary state. Health, readiness, and persistence wiring were inspected on 2026-10-05/06. | **Operationally validated in a narrow scope**; see [Render operational evidence](platform/render-operational-evidence-2026-10-05.md). |
| Render Genesis persistence | PR #88 adds `QUICKSILVER_GENESIS_DIR=/data/genesis`, regression coverage, and portable workflow configuration. | **Merged implementation**; live post-merge verification is still pending. |
| Browser OIDC foundation | Authorization-code/PKCE, signed ID-token validation, durable server-side sessions, mapping to local roles, revocation, and route guards are implemented and covered by regressions. An initial live Google sign-in was recorded on 2026-10-03. | **Partial**; see [SSO setup](platform/sso-setup.md). |
| Intent and operating-mode foundations | Aura's provenance-tagged intent graph and ledger, the Onboard shadow-mode playbook, Genesis budget/ledger controls, and the Operate reinvestment foundation are implemented. | **Built, not operationally complete**; pilots and real-account evidence remain. |

## Not complete or not yet proven

- **CI is not green.** [PR #88](https://github.com/nueraresearch/project-quicksilver/pull/88) was merged with both Ubuntu and Windows `verify` jobs failed in the shared “Run regression suites and type checks” step. The Ubuntu log identifies `host:test` as the failing verification stage; GitHub's annotations expose only a generic exit-code failure, so the precise assertion still needs a fresh diagnostic run. Do not treat the current main branch as release-verified until this is resolved.
- **Live post-PR #88 verification is pending.** The Render evidence predates the Genesis-persistence merge; confirm the new startup persistence signal and absence of the Genesis in-memory warning without writing business data.
- **No real effectful provider workflow is proven.** Email, payment, webhook, and connector paths remain dry-run, fake-provider, or record-only boundaries. No real email or webhook has been sent by this code.
- **The three operating modes lack their required operational evidence.** The Onboard pilot, Genesis run, and Operate period have not occurred; they are not release-complete merely because their foundations are implemented.
- **Enterprise gaps remain.** A fully integrated multi-tenant control plane, stable/published SDK contracts, complete Supervisor Agent, isolated effectful execution, full traces/cost operations, marketplace/domain packs, and compliance evidence are M8–M9 work.
- **OIDC follow-through remains.** Add a console sign-in control and verify session durability after a later deploy; persistent role/principal administration is also open.

## Highest-value near-term work

1. **Restore a green cross-platform CI baseline.** Reproduce and fix the shared `host:test` failure, keep the Windows and Ubuntu matrix, and retain the first useful assertion/stack trace in the log. This is the immediate release blocker.
2. **Run a narrow Render post-deploy check.** Confirm `/healthz`, `/readyz`, and the selected persistence backends after PR #88. Keep it read-only unless a separately approved recovery/test plan calls for a sentinel write and restart.
3. **Close the small OIDC usability gap.** Add the sign-in control and an explicit post-deploy session check; the protocol and route-guard foundation already exist.
4. **Prepare, do not start, the pilots.** The next large evidence gaps are organizational rather than coding tasks: entity/payment-account decisions for Genesis and the scheduled Onboard shadow-mode pilot.

## Source of truth

- [Implementation roadmap](NUERA-QUICKSILVER-ROADMAP.md)
- [Blueprint coverage](NUERA-QUICKSILVER-SPEC-COVERAGE.md)
- [Parity test matrix](platform/parity-tests.md)
- [M8–M9 enterprise plan](M8-M9-ENTERPRISE-PLAN.md)

The linked documents define the detailed feature and release criteria. This page
is the maintained entry point for the current done/not-done distinction.
