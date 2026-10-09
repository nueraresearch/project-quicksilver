# Contributing to Nuera Quicksilver

Thanks for contributing. Nuera Quicksilver is a TypeScript monorepo for a governed automation platform. The repository contains a web console, Sanity Studio, a deterministic kernel, agent adapters, a single-tenant host, and internal SDK foundations.

## Before you start

- Node.js **22.6 or newer** is required. The regression suites run TypeScript
  directly through `node --experimental-strip-types`, which is not available
  before 22.6. CI pins Node 22; `.nvmrc` records the same major.
- Run commands from the repository root.
- Do not commit `.env`, tokens, vault keys, Sanity credentials, model keys, or generated runtime data.
- The default regression suite does not require Sanity or model credentials.

## Install and verify

```bash
npm ci
npm run verify
npm run build --workspace=@quicksilver/web
```

`npm run verify` runs the credential-free regression suites and TypeScript checks. It does not deploy schemas, seed Sanity, call an LLM provider, or build the Sanity Studio.

**Run the web build too.** `verify` type-checks but never bundles, so a change can pass every test and still fail to deploy. CI runs `web-build` as a required check for exactly this reason; reproduce it locally before opening a pull request:

```bash
npm run build --workspace=@quicksilver/web
```

That build is credential-free. The full workspace build is not, because Studio needs a configured dedicated Sanity project:

```bash
npm run build
```

The web application can build without live credentials. The Studio build requires a valid `SANITY_STUDIO_PROJECT_ID` for the dedicated Nuera Quicksilver project.

## Useful commands

| Command | Purpose | Credentials required |
|---|---|---:|
| `npm run verify` | Regression suites and type checks | No |
| `npm run build --workspace=@quicksilver/web` | Build the web console (CI's `web-build`) | No |
| `npm run build` | Build all workspaces | Dedicated Sanity project for Studio |
| `npm run dev:web` | Start the Next.js console | Usually yes for live routes |
| `npm run dev:studio` | Start Sanity Studio | Dedicated Sanity project |
| `npm run schema:deploy` | Deploy Studio schemas | Sanity auth |
| `npm run seed` | Seed the dedicated Sanity dataset | Sanity auth and write token |
| `npm run verify:mcp` | Check Sanity Context MCP | Context MCP credentials |
| `npm run verify:llm` | Check configured model providers | Model credentials |
| `npm run host:test` | Test the hosted runtime | No |
| `npm run e2e:live` | Run the live Sanity end-to-end test | Sanity and model credentials |

Run an individual package suite when iterating:

```bash
npm run kernel:test
npm run agent:test
npm run host:test
npm run aura:test
npm run seed:test
npm run typecheck
```

## Repository boundaries

- `packages/kernel` contains deterministic authorization, risk, process, workflow, NQC evaluation, durable runs, triggers, identity, and simulation. It must not depend on an LLM.
- `packages/agent` contains model configuration, MCP access, prompts, and governed agent workers. Agents propose; they do not authorize or execute privileged actions.
- `packages/host` contains the single-tenant worker process, management API, vault, logs, metrics, and CLI surfaces.
- `packages/aura` contains the intent and provenance layer. It may update agent-inferred beliefs only through governed paths.
- `apps/web` contains the console and API routes.
- `apps/studio` contains Sanity schemas and seed tooling.

## Non-negotiable design rules

1. **Agents propose; the NQC Kernel authorizes.** Never move authority into a prompt, model response, or agent manifest.
2. **Fail closed.** Missing credentials, malformed policy/process data, missing evidence, invalid approvals, and unsafe tool manifests must refuse work rather than guess.
3. **Workflows are data.** Conditions and guards use validated structured data, never evaluated code strings.
4. **Human transitions stay human.** Approval, rejection, rollback, spending, and other sensitive actions require the configured human authority.
5. **Preserve auditability.** Decisions, policy snapshots, action fingerprints, evaluations, and process transitions must remain inspectable.
6. **Do not store private chain-of-thought.** Persist concise decision artifacts, citations, evaluations, and observable outcomes instead.

## Making changes

1. Create a focused branch from `main`.
2. Add or update tests with behavior changes, especially for authorization, identity, tenant isolation, credentials, or route access.
3. Update the relevant canonical documentation when behavior or status changes.
4. Run `npm run verify` before opening a pull request.
5. If the change needs Sanity, a provider, a vault, or public hosting, document the exact operational prerequisite and failure mode.

## Documentation map

- [README](README.md): project overview, current status, setup, and navigation.
- [Product definition](docs/NUERA-QUICKSILVER-PRODUCT.md): target product and modes.
- [Roadmap](docs/NUERA-QUICKSILVER-ROADMAP.md): milestones and gaps.
- [Parity tests](docs/platform/parity-tests.md): release-gate requirements.
- [Glossary](docs/GLOSSARY.md): project terminology.
- [Architecture](ARCHITECTURE.md): current system boundaries and data model.

## Reporting security issues

Do not publish credentials, private datasets, exploit details, or sensitive logs in an issue. Follow the private reporting process in [SECURITY.md](SECURITY.md). Private vulnerability reporting is enabled on this repository, so the Security tab opens a private advisory that only you and the maintainers can see.

## Updating pinned GitHub Actions

The workflows reference actions by commit SHA, with the version in a trailing
comment. A tag can be moved after you trust it; a SHA cannot. Dependabot does not
open PRs for tag moves, so bumps are deliberate:

```bash
# 1. Resolve the tag you want to move to.
gh api repos/actions/checkout/git/ref/tags/v5 --jq .object.sha

# 2. Update every `uses:` line in .github/workflows, keeping the version comment.
#    An annotated tag resolves to a tag object; follow .object.sha to the commit.

# 3. Confirm nothing is left on a floating tag.
grep -rn 'uses:.*@v[0-9]' .github/workflows   # must return nothing
```

Keep the `# vX` comment accurate. It is the only human-readable record of what a
SHA corresponds to, and the SHA alone tells a reader nothing.
