# Nuera Quicksilver documentation

Nuera Quicksilver (this repository, `nueraresearch/project-quicksilver`) was inspired
by Quicksilver, our Sanity Challenge 2026 submission, which lives separately at
[nuerainc/quicksilver-sanity-challenge](https://github.com/nuerainc/quicksilver-sanity-challenge).

- [Current project status](CURRENT-STATUS.md): what is built, operationally evidenced, blocked, and next
- [Product definition](NUERA-QUICKSILVER-PRODUCT.md): what Nuera Quicksilver is being built to become (layers, modes, playbooks, goals)
- [NQC Kernel and Quicksilver Engine](nqc/README.md)
- [Platform architecture](platform/README.md)
- [API contract and OpenAPI](api/api-contract.md)
- [Web governed-agent profiles](platform/agent-profiles.md): profile bindings, reviewed resources, and deployment-scoped memory limits
- [Implementation roadmap](NUERA-QUICKSILVER-ROADMAP.md)
- [Partial parity execution program](PARTIAL-PARITY-EXECUTION-PLAN.md): staged delivery for the remaining non-deferred P-items
- [Usability plan: attention list, sign-in, approvals inbox, chat as the only agent entry](USABILITY-PLAN.md)
- [Enterprise specification coverage](NUERA-QUICKSILVER-SPEC-COVERAGE.md)
- [Canonical naming](NUERA-QUICKSILVER-NAMING.md)
- [Glossary](GLOSSARY.md): project terminology and status vocabulary
- [Contributor guide](../CONTRIBUTING.md): setup, verification, boundaries, and design rules
- [Agent orientation](../AGENTS.md): package boundaries and invariants, for coding agents
- [Security policy](../SECURITY.md): how to report a vulnerability privately
- [Parity tests](platform/parity-tests.md): release-gate requirements and evidence
- [v1.0.0 execution plan](V1-PLAN.md): dependency-aware implementation, pilot, and release gates
- [v1 scope decision](V1-SCOPE.md): approved P-001–P-123 v1.0.0 baseline and remaining operational decisions
- [NQC evaluation benchmark plan](NQC-EVALUATION-BENCHMARK.md): held-out measurement protocol and claim gates
- [authoritative enterprise specification](NUERA-QUICKSILVER-ENTERPRISE-SPEC-v1.md): merged platform target and Supervisor Agent contract
- [M8–M9 enterprise plan](M8-M9-ENTERPRISE-PLAN.md): feature-complete release candidate, hardening, evidence, and 1.0.0 gate
- [M7 release evidence](platform/m7-release-evidence.md): executable acceptance matrix and verification results for all four M7 parts

## Strategy and background reading

- [Sanity as a platform: what it would take](SANITY-PLATFORM-PLAN.md)
- [Path One](PATH-ONE.md) · [Path Two](PATH-TWO.md)
- [What Nuera Quicksilver is building](NUERA-QUICKSILVER-PRODUCT.md)

## Demo and judging

- [Judge guide](FOR-JUDGES.md): what to look at and what has been proven
- [Demo script](DEMO-SCRIPT.md)

## History

These describe the withdrawn Sanity Challenge entry or the build as it stood at a
point in time. They are kept for provenance and are marked with a banner. They do
not describe this platform's current capability or deployment environment.

- [`SUBMISSION.md`](../SUBMISSION.md): the withdrawn Sanity Challenge submission
- [`BUILD-LOG.md`](../BUILD-LOG.md): synthesized build history across three environments
- [DEV post, Path One, withdrawn entry](DEV-POST-PATH-ONE.md)
- [DEV post, Path Two, withdrawn entry](DEV-POST-PATH-TWO.md)
- [DEV post, Nuera Quicksilver Path One](DEV-POST-NUERA-PATH-ONE.md)
- [NQC benchmark write-up](NQC-EVALUATION-BENCHMARK.md)

For a first contribution, start with the [repository README](../README.md), then
run `npm run verify` and read the [contributor guide](../CONTRIBUTING.md).