# Current project status

**Snapshot date:** 2026-10-14
**Repository baseline:** `da0c445` — current `main` when this snapshot was last reconciled by hand

This is a concise operational and implementation snapshot. It separates code
that exists from live evidence that has been collected, so it must not be read
as a 1.0.0 readiness claim. It is intentionally conservative about operational
proof, but it should still make the breadth of implemented surface area legible.

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
| M1–M7 governance foundation | Kernel governance, durable runs, triggers, host process, Aura intent layer, the Operator Organization Layer, Genesis/Onboard/Operate foundations, and the M7 acceptance matrix are implemented. | **Implementation complete through 0.8.0**; see [M7 release evidence](platform/m7-release-evidence.md). |
| Single-tenant hosted runtime | The host has a Render deployment with PostgreSQL for runs and a mounted `/data` disk for auxiliary state. Persistence wiring was inspected on 2026-10-05/06. A read-only recheck on 2026-10-08 against the **currently deployed** service returned `{"status":"ok"}` from `/healthz`, `{"status":"ready"}` from `/readyz`, and the expected `401` from unauthenticated `GET /api/whoami`. | **Operationally validated in a narrow scope**; see [Render operational evidence](platform/render-operational-evidence-2026-10-05.md). |
| Genesis persistence on the host | `genesis-cli.ts` resolves `QUICKSILVER_GENESIS_DIR`, defaulting to `data/genesis`, and the Render Blueprint sets `/data/genesis`. Regression coverage exists. | **Implementation merged, but not evidenced live.** The startup persistence signal and the absence of the Genesis in-memory warning live in the Render service logs, which are not readable without Render access. No sentinel write has been performed. |
| Governed agent profiles and host memory API | PR #92 adds web-profile bindings for planner/reviewer/query/specialist routes, reviewed skill/routine/context loading, optional isolated agent memory, and authenticated governed host-memory routes. | **Merged and regression-tested; P-017/P-018 remain partial** for production-owned resources, operational model evidence, full-text recall, unified preferences, and shared multi-tenant storage. See [agent profiles](platform/agent-profiles.md) and the [parity matrix](platform/parity-tests.md). |
| Browser OIDC sign-in and sessions | Authorization-code/PKCE, signed ID-token validation, tenant-scoped durable sessions, role mapping, revocation, route guards, sign-in/sign-out controls, and account pages are implemented. Live Google allowlist/refusal and sign-in evidence was recorded on 2026-10-03; session persistence across production redeploys is now recorded. | **P-108 covered**; persistent principal/role administration and integrated multi-tenant hosting remain open. See [SSO setup](platform/sso-setup.md) and the [parity matrix](platform/parity-tests.md). |
| Intent and operating-mode foundations | Aura's provenance-tagged intent graph and ledger, the Onboard shadow-mode playbook, Genesis budget/ledger controls, and the Operate reinvestment foundation are implemented. | **Built, not operationally complete**; pilots and real-account evidence remain. |
| Operator Organization Layer | `packages/operator` adds the operator queue, the review engine, an in-app calendar, autonomous background routines, governed communication dispatch, and credential-free iCal sync, with `/operator/{queue,calendar,review}` and matching API routes. Sanity schemas exist for commitment, contact, drafted communication, review and scheduled item. | **Built and credential-free tested**; 18 tests across six suites. **Not operationally proven** — no deployment exercises these routes, and they were not deployed during this change. |

## Not complete or not yet proven

- **CI status is a point-in-time signal.** Passing merge checks are useful regression evidence, not proof of live business-provider execution or 1.0.0 readiness; check GitHub Actions for the status of later commits.
- **Genesis persistence on the live host is not evidenced.** `genesis-cli.ts` resolves `QUICKSILVER_GENESIS_DIR` and the Render Blueprint sets `/data/genesis`, and the code path is regression-tested. What is missing is live proof: the startup persistence signal and the absence of the Genesis in-memory warning live in the Render service logs, which are not readable without Render access. No sentinel write has been performed, because that changes business state. This is an evidence gap, not a known failure.
- **No real effectful provider workflow is proven.** Email, payment, webhook, and connector paths remain dry-run, fake-provider, or record-only boundaries. No real email or webhook has been sent by this code.
- **The three operating modes lack their required operational evidence.** The Onboard pilot, Genesis run, and Operate period have not occurred; they are not release-complete merely because their foundations are implemented.
- **Two plaintext principal tokens exist outside version control.** `.work/render-repair/brodi-principal-tokens.txt` holds live tokens for `entity-founder` (holding `intent-provider, supervisor, developer`) and `entity-engineering-agent`. They are gitignored and were confirmed absent from git history and every tracked file, but whoever holds them can approve decisions. Rotation is founder-only and is the first near-term item below.
- **Measured routing is declared but not running.** The durable outcome history exists and is declared in both hosting templates (`QUICKSILVER_ROUTING_CONFIG` and `QUICKSILVER_ROUTING_HISTORY_PATH`), with a documented enablement procedure. It is enabled in no deployment, so there is no evidence of learned routing under live traffic and the rollback path has never been exercised. The two variables must be set together; the history path alone makes every measured call refuse. See [enabling measured model routing](platform/routed-model-enablement.md).
- **Most declared API response schemas are still not verified, but the stated reason was wrong.** `apps/web/lib/api-response-schema.test.ts` used to validate only 4 of 51 handlers. This page previously attributed that to missing Sanity credentials; it was not. The test's own principal fixture carried the literal `sha256:test-owner` instead of a real digest, and its bearer was 10 characters against a `MIN_TOKEN_LENGTH` of 32, so the identity provider refused to build and every guarded route answered 503 before reaching any of its own logic. With a real digest, a valid-length token, `getSanityClient` answering each query shape the way an empty dataset really does, and request bodies generated from the contract's own declared `requestBody`, **23 of 51 now validate** and no route fails request validation. A control test confirms the coverage is real rather than skipped: forcing `DecisionList.hasMore` to `integer` fails the suite. The remaining 28 are a different class of gap and need seeded data rather than better requests — 11 answer 404 because the store is empty, 7 answer 503 and 6 answer 500 because a model provider, product-memory root or entity store is unconfigured, and `/api/auth/session` answers 401 with no browser session. Closing those needs a seeded Sanity dataset (including digests the agent catalog's own `assertAgentDigest` accepts) and per-route provider stubs. The mock carries no documents, so array *element* shapes are verified only for responses built from non-storage data.
- **Enterprise gaps remain.** A fully integrated multi-tenant control plane, stable/published SDK contracts, complete Supervisor Agent, isolated effectful execution, full traces/cost operations, marketplace/domain packs, and compliance evidence are M8–M9 work.
- **Host trace spans are now persisted, but nothing reads them yet.** `packages/host/src/host.ts` previously constructed `HostTraceTracer` with no sink, so all three call sites (queue dispatch, schedule tick, webhook intake) returned `undefined` and stored nothing. `HostDependencies.traceSpanSink` is now the injection seam, `main.ts` wires `FileTraceSpanSink`, and spans are appended as fsynced JSONL at `QUICKSILVER_TRACE_SPAN_PATH` (default `<data dir>/trace-spans.jsonl`, set explicitly in both `deploy/render.yaml` and `deploy/azure/main.bicep`). A host with no durable path logs a startup warning instead of silently dropping spans. What is still missing: rotation/retention, and any reader — `/monitoring/traces` reads the Vercel-side store, so host spans are durable but not yet visible in the console. This is why P-114 stays `partial`.
- **Persistent identity administration is implemented, not operationally proven.** `packages/kernel/src/identity/principal-admin.ts` adds a governed administration engine: deny-by-default, tenant-scoped, separation of duties with no self-grant, authority roles assignable only to humans, and mutation that aborts if the audit write fails. It has five credential-free regression tests. What is missing is deployment and dated operational evidence; no deployment exercises the path. The P-108 sign-in/session path remains covered.

## Highest-value near-term work

Ordered by what actually unblocks the most, not by effort.

1. **Rotate the live principal tokens.** `.work/render-repair/brodi-principal-tokens.txt` holds two plaintext tokens (`entity-founder` with `intent-provider, supervisor, developer`, and `entity-engineering-agent`). They are gitignored and were never in git history, but they grant `decision:approve`. If they are still valid on Render they are the highest-severity live exposure, and only the founder can rotate them.
2. **Close A-7, the last threat-model P0 blocker.** Confirm `SANITY_READ_TOKEN` and `SANITY_WRITE_TOKEN` are set in Vercel and Render, delete the old combined `SANITY_AUTH_TOKEN` in sanity.io/manage, and review who holds Editor or higher in Studio. No Sanity credential exists in any local env file (`.env`, `.env.local`), so nothing can be verified from a developer machine. This is independent of the Sanity Challenge: the Challenge project `d280bqjc` is refused by the code, and the combined token belongs to the Quicksilver project `f87t11g1`.
3. **Run the live decision loop (P-121).** `npm run e2e:live` already exists and refuses correctly without credentials. With `NEXT_PUBLIC_SANITY_PROJECT_ID=f87t11g1`, `SANITY_WRITE_TOKEN` and `QUICKSILVER_SUPERVISOR_TOKEN` in `.env` it runs against the deployed Vercel app by default. Recording a dated pass closes an evidence item outright.
4. **Enable measured routing (P-050).** Set both `QUICKSILVER_ROUTING_CONFIG` and `QUICKSILVER_ROUTING_HISTORY_PATH` in Render, on the mounted disk. Both must be set together: the history path alone makes every measured call throw. The procedure, the four fail-closed traps and the three kill switches are in [enabling measured model routing](platform/routed-model-enablement.md).
5. **Decide the 1.0.0 deprecation window.** The promise is decided as mandatory; the remaining work is listed in [the API contract](api/api-contract.md#what-a-100-promise-still-requires). The window length is the only input that is purely a product-owner decision. The root `CHANGELOG.md` now records releases, but it does not express per-SDK compatibility, so that policy still has to be written.
6. **Read the Render service logs for the Genesis persistence signal.** Health, readiness, and the unauthenticated identity refusal were rechecked read-only on 2026-10-08. The remaining gap is the startup log: confirm `QUICKSILVER_GENESIS_DIR` is resolved and that the Genesis in-memory warning is absent. This needs Render access, not a code change. Keep it read-only; a sentinel write and restart needs a separately approved recovery plan.
7. **Operationalize principal/role administration.** The governed administration engine now exists in source; the remaining work is deployment, dated evidence, and the durable management workflow around it. Do not treat the completed P-108 sign-in experience as covering administrative lifecycle needs.
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
