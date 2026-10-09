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
| Single-tenant hosted runtime | The host has a Render deployment with PostgreSQL for runs and a mounted `/data` disk for auxiliary state. Persistence wiring was inspected on 2026-10-05/06. A read-only recheck on 2026-10-08 against the **currently deployed** service returned `{"status":"ok"}` from `/healthz`, `{"status":"ready"}` from `/readyz`, and the expected `401` from unauthenticated `GET /api/whoami`. | **Operationally validated in a narrow scope**; see [Render operational evidence](platform/render-operational-evidence-2026-10-05.md). |
| Genesis persistence on the host | `genesis-cli.ts` resolves `QUICKSILVER_GENESIS_DIR`, defaulting to `data/genesis`, and the Render Blueprint sets `/data/genesis`. Regression coverage exists. | **Implementation merged, but not evidenced live.** The startup persistence signal and the absence of the Genesis in-memory warning live in the Render service logs, which are not readable without Render access. No sentinel write has been performed. |
| Governed agent profiles and host memory API | PR #92 adds web-profile bindings for planner/reviewer/query/specialist routes, reviewed skill/routine/context loading, optional isolated agent memory, and authenticated governed host-memory routes. | **Merged and regression-tested; P-017/P-018 remain partial** for production-owned resources, operational model evidence, full-text recall, unified preferences, and shared multi-tenant storage. See [agent profiles](platform/agent-profiles.md) and the [parity matrix](platform/parity-tests.md). |
| Browser OIDC sign-in and sessions | Authorization-code/PKCE, signed ID-token validation, tenant-scoped durable sessions, role mapping, revocation, route guards, sign-in/sign-out controls, and account pages are implemented. Live Google allowlist/refusal and sign-in evidence was recorded on 2026-10-03; session persistence across production redeploys is now recorded. | **P-108 covered**; persistent principal/role administration and integrated multi-tenant hosting remain open. See [SSO setup](platform/sso-setup.md) and the [parity matrix](platform/parity-tests.md). |
| Intent and operating-mode foundations | Aura's provenance-tagged intent graph and ledger, the Onboard shadow-mode playbook, Genesis budget/ledger controls, and the Operate reinvestment foundation are implemented. | **Built, not operationally complete**; pilots and real-account evidence remain. |

## Not complete or not yet proven

- **PR #92 test checks passed at merge.** The project owner confirmed the merge completed without test failures on 2026-10-06. This is a point-in-time CI result, not evidence of live business-provider execution or 1.0.0 readiness; check GitHub Actions for the status of later commits.
- **Genesis persistence on the live host is not evidenced.** `genesis-cli.ts` resolves `QUICKSILVER_GENESIS_DIR` and the Render Blueprint sets `/data/genesis`, and the code path is regression-tested. What is missing is live proof: the startup persistence signal and the absence of the Genesis in-memory warning live in the Render service logs, which are not readable without Render access. No sentinel write has been performed, because that changes business state. This is an evidence gap, not a known failure.
- **No real effectful provider workflow is proven.** Email, payment, webhook, and connector paths remain dry-run, fake-provider, or record-only boundaries. No real email or webhook has been sent by this code.
- **The three operating modes lack their required operational evidence.** The Onboard pilot, Genesis run, and Operate period have not occurred; they are not release-complete merely because their foundations are implemented.
- **Two plaintext principal tokens exist outside version control.** `.work/render-repair/brodi-principal-tokens.txt` holds live tokens for `entity-founder` (holding `intent-provider, supervisor, developer`) and `entity-engineering-agent`. They are gitignored and were confirmed absent from git history and every tracked file, but whoever holds them can approve decisions. Rotation is founder-only and is the first near-term item below.
- **Measured routing is declared but not running.** The durable outcome history exists and is declared in both hosting templates (`QUICKSILVER_ROUTING_CONFIG` and `QUICKSILVER_ROUTING_HISTORY_PATH`), with a documented enablement procedure. It is enabled in no deployment, so there is no evidence of learned routing under live traffic and the rollback path has never been exercised. The two variables must be set together; the history path alone makes every measured call refuse. See [enabling measured model routing](platform/routed-model-enablement.md).
- **Most declared API response schemas are not yet verified against live output.** Every operation declares a named success schema, and three that were anonymous now have named ones. But `apps/web/lib/api-response-schema.test.ts` exercises only 4 of 46 handlers in a credential-free run, because 42 return 401/503 without Sanity credentials. A control test confirms the limit precisely: breaking `AuthStatus` fails the suite, while breaking `DecisionDetail` passes because that route never reaches a success path. Closing this needs an injectable transport.
- **Enterprise gaps remain.** A fully integrated multi-tenant control plane, stable/published SDK contracts, complete Supervisor Agent, isolated effectful execution, full traces/cost operations, marketplace/domain packs, and compliance evidence are M8–M9 work.
- **Persistent identity administration remains open.** Principal and role administration still needs durable management workflows and audit controls; the P-108 sign-in/session path is covered.

## Highest-value near-term work

Ordered by what actually unblocks the most, not by effort.

1. **Rotate the live principal tokens.** `.work/render-repair/brodi-principal-tokens.txt` holds two plaintext tokens (`entity-founder` with `intent-provider, supervisor, developer`, and `entity-engineering-agent`). They are gitignored and were never in git history, but they grant `decision:approve`. If they are still valid on Render they are the highest-severity live exposure, and only the founder can rotate them.
2. **Close A-7, the last threat-model P0 blocker.** Confirm `SANITY_READ_TOKEN` and `SANITY_WRITE_TOKEN` are set in Vercel and Render, delete the old combined `SANITY_AUTH_TOKEN` in sanity.io/manage, and review who holds Editor or higher in Studio. No Sanity credential exists in any local env file (`.env`, `.env.local`), so nothing can be verified from a developer machine. This is independent of the Sanity Challenge: the Challenge project `d280bqjc` is refused by the code, and the combined token belongs to the Quicksilver project `f87t11g1`.
3. **Run the live decision loop (P-121).** `npm run e2e:live` already exists and refuses correctly without credentials. With `NEXT_PUBLIC_SANITY_PROJECT_ID=f87t11g1`, `SANITY_WRITE_TOKEN` and `QUICKSILVER_SUPERVISOR_TOKEN` in `.env` it runs against the deployed Vercel app by default. Recording a dated pass closes an evidence item outright.
4. **Enable measured routing (P-050).** Set both `QUICKSILVER_ROUTING_CONFIG` and `QUICKSILVER_ROUTING_HISTORY_PATH` in Render, on the mounted disk. Both must be set together: the history path alone makes every measured call throw. The procedure, the four fail-closed traps and the three kill switches are in [enabling measured model routing](platform/routed-model-enablement.md).
5. **Decide the 1.0.0 deprecation window.** The promise is decided as mandatory; the remaining work is listed in [the API contract](api/api-contract.md#what-a-100-promise-still-requires). The window length is the only input that is purely a product-owner decision. The root `CHANGELOG.md` now records releases, but it does not express per-SDK compatibility, so that policy still has to be written.
6. **Read the Render service logs for the Genesis persistence signal.** Health, readiness, and the unauthenticated identity refusal were rechecked read-only on 2026-10-08. The remaining gap is the startup log: confirm `QUICKSILVER_GENESIS_DIR` is resolved and that the Genesis in-memory warning is absent. This needs Render access, not a code change. Keep it read-only; a sentinel write and restart needs a separately approved recovery plan.
7. **Define principal/role administration.** Decide and implement the durable, audited management path; do not treat the completed P-108 sign-in experience as covering administrative lifecycle needs.
8. **Prepare, do not start, the pilots.** The next large evidence gaps are organizational rather than coding tasks: entity/payment-account decisions for Genesis and the scheduled Onboard shadow-mode pilot.
9. **Keep P-017/P-018 operational work explicit.** Production-owned profile resources, live model runs, trusted request-derived tenant identity, shared memory coordination, and complete recall remain open; see the parity matrix.

## Version numbering

`package.json` reads `0.8.0` across the eight Quicksilver packages, matching
`info.version` in [`openapi.json`](api/openapi.json) and the roadmap's verified
milestone baseline: M1 through M7 are implementation-complete, with M7 verified by
[M7 release evidence](platform/m7-release-evidence.md). `@quicksilver/aura` stays
at `0.1.0` and is versioned separately, because Aura runs its own ladder and its
evaluation files are hash-frozen by tests.

`[CHANGELOG.md](../CHANGELOG.md)` records what changed in each release. It did not
exist before 0.8.0; earlier versions are in the repository history and the
roadmap's milestone table, and no earlier entry has been reconstructed.

The manifest version is still **not** the thing that decides readiness. The
[parity matrix](platform/parity-tests.md) frames the 0.9.0 and 1.0.0 gates, and it
states that tests alone are not the 1.0.0 bar — operational evidence is. Use the
matrix to judge where the project actually is.

## Source of truth

- [Implementation roadmap](NUERA-QUICKSILVER-ROADMAP.md)
- [Blueprint coverage](NUERA-QUICKSILVER-SPEC-COVERAGE.md)
- [Parity test matrix](platform/parity-tests.md)
- [M8–M9 enterprise plan](M8-M9-ENTERPRISE-PLAN.md)

The linked documents define the detailed feature and release criteria. This page
is the maintained entry point for the current done/not-done distinction.
