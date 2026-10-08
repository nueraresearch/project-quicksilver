# AGENTS.md

Repo facts for coding agents working in `nueraresearch/project-quicksilver`.

**[CONTRIBUTING.md](CONTRIBUTING.md) is the canonical contributor guide.** It
owns the command table, the setup steps, and the credential requirements. This
file is a short orientation for agents and deliberately does not restate them.
If the two ever disagree, `CONTRIBUTING.md` wins.

## The one-line model

**Agents propose. The NQC Kernel authorizes. A human approves what matters.**
Every step is recorded.

If a change moves authority from the kernel to a prompt, a model response, or an
agent manifest, it is wrong regardless of whether the tests pass.

## Non-negotiable design rules

These are the invariants. They are not preferences.

1. **Agents propose; the NQC Kernel authorizes.** Authority never lives in a
   prompt, model response, or agent manifest.
2. **Fail closed.** Missing credentials, malformed policy or process data,
   missing evidence, invalid approvals, and unsafe tool manifests refuse work
   rather than guess.
3. **Workflows are data.** Conditions and guards use validated structured data,
   never evaluated code strings.
4. **Human transitions stay human.** Approval, rejection, rollback, and spending
   require the configured human authority.
5. **Preserve auditability.** Decisions, policy snapshots, action fingerprints,
   evaluations, and process transitions stay inspectable.
6. **No private chain-of-thought.** Persist decision artifacts, citations,
   evaluations, and observable outcomes instead.

## Package boundaries

| Package | Contains | Must not |
|---|---|---|
| `packages/kernel` | Deterministic authorization, risk, process, workflow, NQC evaluation, durable runs, triggers, identity, simulation | Depend on an LLM. This is the authority. |
| `packages/agent` | Model configuration, MCP access, prompts, governed workers | Authorize or execute privileged actions |
| `packages/host` | Single-tenant worker process, management API, vault, logs, metrics, CLI | Expose authority the kernel did not grant |
| `packages/aura` | Intent and provenance layer | Update agent-inferred beliefs outside governed paths |
| `packages/operator` | Operator CLI, channel adapters, automations, web search | Bypass the kernel through a channel |
| `apps/web` | Console and API routes | Expose data a caller is not authorized to see |
| `apps/studio` | Sanity schemas and seed tooling | Become a source of authority |
| `packages/sdk`, `sdk-go`, `sdk-python` | Client surfaces | Weaken a server-side guarantee |

## Where the truth lives

- **`docs/CURRENT-STATUS.md`** — what is built versus what is operationally
  proven. Claims elsewhere must not contradict it.
- **`docs/platform/parity-tests.md`** — the pass/fail requirements for the
  release gates. P-0xx identifiers come from here.
- **`docs/platform/threat-model.md`** — assets, trust boundaries, and threat
  handling. Relevant when touching credentials, identity, or tenant isolation.
- **`ARCHITECTURE.md`** — current system boundaries and data model.
- **`docs/GLOSSARY.md`** — the project's vocabulary.

## Before opening a pull request

Run `npm run verify`. It is the credential-free regression chain plus type
checks, and it is what CI runs. On Node < 22.6 the test scripts fail, because
they execute TypeScript directly through `node --experimental-strip-types`;
`engines` in `package.json` and `.nvmrc` state the requirement.

Behavior changes ship with tests — including a test that proves the **refusal**
for authorization, identity, tenant isolation, credentials, and route-access
changes. A test that only proves the happy path does not cover the rule that
matters.

## Environment

- Never commit `.env`, tokens, vault keys, Sanity credentials, model keys, or
  generated runtime data. `.gitignore` covers these, with one documented
  exception for `.env.example`.
- Secrets belong in GitHub Actions secrets. `quicksilver.host.json` is tracked
  despite appearing in `.gitignore`, because ignore rules do not apply to
  already-tracked files; it must stay free of real values.
- The credential-free path (`npm run verify`) must keep working without Sanity
  or model credentials. Adding a credential requirement to that path is a
  regression.