# Changelog

All notable changes to Nuera Quicksilver.

The version in `package.json` is the release line for the eight Quicksilver
packages (`quicksilver`, `@quicksilver/web`, `@quicksilver/studio`,
`@quicksilver/agent`, `@quicksilver/host`, `@quicksilver/kernel`,
`@quicksilver/operator`, `@nuera/quicksilver-sdk`) and for
`info.version` in [`docs/api/openapi.json`](docs/api/openapi.json).

`@quicksilver/aura` is versioned separately and is **not** part of this line.
Aura runs its own ladder, and the roadmap describes it as decoupled from
Quicksilver's releases. Its evaluation files are hash-frozen by tests, so an
Aura change never appears here.

This file did not exist before 0.8.0. Versions before it are recorded in the
repository history and in the roadmap's milestone table; this is a new record,
not a reconstruction, and no earlier entry has been invented.

## What a version means here

Use the [parity matrix](docs/platform/parity-tests.md) to judge where the
project actually is — not this file and not the manifest. The matrix states
that tests alone are not the 1.0.0 bar; operational evidence is.

- **0.9.0** is the release candidate: all three modes (Genesis, Onboard,
  Operate) pass the parity gate **in testing**.
- **1.0.0** requires the same gate **with operational evidence** — pilot and
  demo results, not only tests.

## [Unreleased]

Nothing yet.

## [0.8.0] — 2026-10-09

First release where the manifest version matches the verified milestone
baseline. M1 through M7 are implementation-complete, with M7 verified by
[M7 release evidence](docs/platform/m7-release-evidence.md).

This release changes no behaviour and breaks no API. It corrects a version that
had read `0.4.0` in every Quicksilver manifest since M3, while the roadmap had
recorded M1–M7 as complete.

### Added

- **Measured model routing** (`packages/agent`). An opt-in durable outcome
  history at `QUICKSILVER_ROUTING_HISTORY_PATH` records model, task, success,
  latency and rate-limit signal per call, and replayed into the profile set that
  `routeForRole` receives, so dispatch is learned from outcomes rather than
  static configuration. The log is a SHA-256 digest chain bound to a baseline of
  the model profiles it was written against; corruption, a changed baseline, a
  stale lock or a failed write all refuse to dispatch rather than dropping the
  record. A rollback requires a named human and appends instead of rewriting.
  Outcome metadata only — never prompts or model output. Declared in both the
  Render blueprint and the Azure Bicep template, and enabled in no deployment.
  See [enabling measured model routing](docs/platform/routed-model-enablement.md).
- **Human-reviewed Genesis research prior import** (`packages/host`), with
  CLI and HTTP-API parity.
- `apps/web/proxy.ts` (renamed from `middleware.ts`) applying a per-request CSP
  nonce and the cross-site guard, on the Node runtime.

### Changed

- Next.js 15.5.27 → **16.4.0** and TypeScript 5.9.3 → **7.0.2**, for TS 7
  support. `"types": ["node"]` added to six tsconfigs that TS 7 no longer
  includes automatically.
- Repository setup: description and topics, `SECURITY.md` with private
  vulnerability reporting, Dependabot with SHA-pinned actions, `CODEOWNERS`,
  issue templates, 12 domain labels, `AGENTS.md`, `.editorconfig`,
  `.gitattributes`, `.nvmrc`. Node contract raised to `>= 22.6`.
- CI now runs `web-build` and `dependency-audit` as required checks alongside
  `verify` (ubuntu + windows), `go-sdk` and `python-sdk`. Building the web
  console is what stopped a change passing every check and still failing to
  deploy.
- `sharp` 0.35.4 → 0.35.5 and `source-map-js` 1.2.1 → 1.2.2 via root
  `overrides`; 20 remaining build-time advisories each carry a recorded decision
  in [dependency advisory decisions](docs/platform/dependency-advisories.md).

### Fixed

- A cancelled bounded batch could record fewer results than it was given, leak
  a `setTimeout`, and leak an abort listener.
- **A batch cancellation that landed while a workspace was being created did
  not stop the item.** `executeBoundedBatch` checked `parent.aborted`, then
  awaited `mkdtemp` before attaching the listener, so a parent that aborted
  during that await got a listener on an already-aborted signal — which never
  fires. The batch reported `cancelled`, but the item's signal stayed live, so a
  real executor kept working. The item now never starts.

### Contract

- Every operation declares a named success response schema; the three that were
  anonymous inline now have named ones (`DecisionAuditExport`,
  `ProductMemoryWriteResult`).
- The response-schema test's own detector had two defects — it looked the
  contract up by a path that did not match the template placeholder, and
  assumed status 200 — which made 11 operations read as undeclared. Fixed;
  routes actually exercised went from 32 to 46.
- Coverage is honestly partial: 42 of 46 handlers return 401/503 without Sanity
  credentials, so most declared schemas are derived from the handlers rather
  than verified against live responses. P-118 remains `partial`, and the work a
  1.0.0 promise still requires is listed in
  [the API contract](docs/api/api-contract.md#what-a-100-promise-still-requires).

### Known open

These are unchanged by this release and are tracked in the
[parity matrix](docs/platform/parity-tests.md): 88 covered, 26 partial, 0
missing, 9 requiring operational evidence. The parity totals gate 0.9.0 and
1.0.0, not this version.

There is no `v0.8.0` git tag yet, so this section has no compare link. Tagging
is a release step and is deliberately not done here.