# Security Policy

Nuera Quicksilver is a governance platform: agents propose, the NQC Kernel
authorizes, and every decision is recorded. A vulnerability here is a
vulnerability in how authority, evidence, or secrecy is handled, so we treat
reports on that path seriously.

## Reporting a vulnerability

**Report privately through GitHub.** Use
[Security → Report a vulnerability](https://github.com/nueraresearch/project-quicksilver/security/advisories/new)
on this repository. That opens a private advisory visible only to you and the
maintainers, and it does not require a GitHub account to be public.

Do not open a public issue for a suspected vulnerability, even an obvious one.
Public reports give every deployment a head start.

## What to include

- The affected component (`packages/kernel`, `packages/agent`, `packages/host`,
  `packages/aura`, `packages/operator`, `apps/web`, `apps/studio`, or an SDK).
- What an attacker can achieve, not just what looks wrong.
- The smallest reproduction you can manage. A failing test is ideal.
- Whether the issue crosses a tenant boundary, escalates privilege, or
  bypasses a human approval gate. Those are treated as highest severity.

## What we consider in scope

- Authorization decisions made by anything other than the NQC Kernel.
- Fail-open behavior where a policy, credential, or evidence check was expected
  to refuse.
- Cross-tenant data access.
- Approval gates that can be satisfied without the configured human authority.
- Secrets exposure: vault contents, tokens, model keys, or production data in
  the repository or in logs and audit records.
- Stored private chain-of-thought. The platform is designed to persist decision
  artifacts, citations, evaluations, and observable outcomes instead.

## What is out of scope

- Findings that depend on an attacker already holding a configured human or
  supervisor credential.
- Denial of service through volume alone, without an amplification or
  authorization flaw.
- Missing hardening headers on a demo or judge-facing route, where no
  authenticated data is exposed.
- The absence of multi-tenant isolation on deployments documented as
  single-tenant, where the exposure is already stated in
  [Current status](docs/CURRENT-STATUS.md).

## Response

We aim to acknowledge a report within a few days and to keep you updated as a
fix takes shape. Severity is judged by what the vulnerability allows, not by
where the code sits. If a fix changes governance behavior, the corresponding
canonical documentation is updated in the same change — see the
[contributor guide](CONTRIBUTING.md).

## Supported versions

The repository has no published releases yet, so there is no version matrix to
support. Security fixes land on `main` and are picked up by whoever tracks it.