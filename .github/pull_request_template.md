<!--
Thanks for contributing to Nuera Quicksilver.

This repository enforces deterministic governance in code. A pull request that
weakens any rule below will be rejected even if the tests pass.

CONTRIBUTING.md is the canonical contributor guide. Read it before your first
change; this template only collects what a reviewer needs to see.
-->

## What this changes

<!-- One or two sentences. What behavior changes, and for whom. -->

## Why

<!-- The problem this solves. Link the issue, parity item (P-0xx), or doc that
     motivates it. If there is no prior art, say what breaks without it. -->

## Governance impact

Every change must answer these. Answer "none" with a reason where that is true.

- [ ] **Agents still propose; the NQC Kernel still authorizes.** No authority
      moved into a prompt, model response, or agent manifest.
- [ ] **Still fails closed.** Missing credentials, malformed policy or process
      data, missing evidence, and invalid approvals refuse work rather than guess.
- [ ] **Workflows remain data.** Conditions and guards use validated structured
      data, never evaluated code strings.
- [ ] **Human transitions stay human.** Approval, rejection, rollback, and
      spending still require the configured human authority.
- [ ] **Auditability preserved.** Decisions, policy snapshots, action
      fingerprints, evaluations, and process transitions remain inspectable.
- [ ] **No private chain-of-thought stored.** Concise decision artifacts,
      citations, evaluations, and observable outcomes only.

## Scope of the diff

- [ ] Touches `packages/kernel` — deterministic authorization, risk, process,
      workflow, NQC evaluation, durable runs, triggers, identity, simulation.
      This package **must not depend on an LLM**.
- [ ] Touches `packages/agent` — model configuration, MCP access, prompts,
      governed workers. Agents propose; they do not authorize or execute
      privileged actions.
- [ ] Touches `packages/host` — single-tenant worker, management API, vault,
      logs, metrics, CLI.
- [ ] Touches `packages/aura` — intent and provenance layer. Agent-inferred
      beliefs change only through governed paths.
- [ ] Touches `apps/web` — console and API routes.
- [ ] Touches `apps/studio` — Sanity schemas and seed tooling.
- [ ] Touches `packages/operator` or the SDKs — operator CLI/channels and the
      TypeScript, Go, and Python SDK surfaces.

If you checked a boundary, state what you checked and why the boundary still holds.

## Tests

- [ ] Added or updated tests alongside the behavior change.
- [ ] `npm run verify` passes locally (credential-free regression suites plus
      type checks).
- [ ] Covered the failure path, not only the happy path. Authorization, identity,
      tenant isolation, credentials, and route access changes require a test that
      proves the **refusal**.

## Operational prerequisites

<!-- If this needs Sanity, a model provider, a vault, or public hosting: state
     the exact prerequisite and the exact failure mode when it is absent.
     Write "none" if the change is self-contained. -->

- [ ] No new environment variable, or `.env.example` updated.
- [ ] No new secret, or the secret is stored in GitHub Actions secrets and never
      in the repository or a committed config file.

## Documentation

- [ ] Updated the canonical documentation where behavior or status changed.
      `docs/CURRENT-STATUS.md` is the maintained source for what is built versus
      what is proven.
- [ ] Corrected any statement that was already inaccurate, rather than adding a
      second document that disagrees with the first.

## Review notes

<!-- Anything a reviewer should look at first: risky areas, deliberate tradeoffs,
     follow-up work, or known gaps you are not fixing here. -->