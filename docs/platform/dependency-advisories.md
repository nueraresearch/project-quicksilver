# Dependency advisory decisions (P-109)

Parity item **P-109** requires two things: no high-severity advisory in a runtime
dependency path, and a recorded decision for every advisory.

`npm run audit:deps` enforces both. It reports what `npm audit` finds, walks the
*production* dependency tree of every serving workspace, and fails when a
high-severity advisory appears in that tree or when an advisory has no decision
recorded below.

## Why the classification is not just `npm audit`

In an npm workspace, dev and production dependencies are hoisted into one
`node_modules`, so `npm audit` reports a build tool exactly like a shipped one.
`npm audit --omit=dev` does not separate them either, because the tree is shared.

The gate therefore scopes to the workspaces that serve requests:

- `apps/web` — the Next.js console on Vercel
- `packages/kernel`, `packages/agent`, `packages/host`, `packages/aura`,
  `packages/operator`, `packages/sdk` — the host on Render

`apps/studio` is deliberately excluded. Sanity Studio compiles to static output
that is uploaded and served as files; `sanity` and `@sanity/cli` run during
schema deploy, seeding and local development, not while serving a request. That
is a judgement, not a fact, and it is the main thing to revisit if the Studio
ever becomes a server-rendered app.

## Runtime-path advisories: none outstanding

Two advisories were in a serving path and have been fixed by pinning a
non-vulnerable version in the root `overrides` block:

| Package | Advisory | Path | Resolution |
|---|---|---|---|
| `sharp` | GHSA-wq5f-xc86-pv6w | `apps/web → next@16.4.0 → sharp@0.35.4` | Pinned to `0.35.5` |
| `source-map-js` | GHSA-68fv-2mgg-jv7q | `apps/web → next@16.4.0 → postcss → source-map-js@1.2.1` | Pinned to `1.2.2` |

Both were transitive. Neither needed a direct dependency change; both sat
inside ranges (`^0.35.4`, `^1.2.1`) that already permitted the fixed version, so
the lockfile simply had not been updated to the newest allowed patch.

## Remaining advisories: build-time, accepted

Every advisory below is reachable only through development or build tooling and
never executes in a request-serving process. They are accepted, not ignored.

| Package | Severity | Class | Decision |
|---|---|---|---|
| `tailwindcss` | high | devDependency of `apps/web`; pulls `chokidar`, `fast-glob`, `micromatch`, `braces` | Accepted. Build-time CSS tooling. Fix is Tailwind 4, a breaking rewrite of every stylesheet; not justified by a build-time advisory. Re-evaluate when Tailwind 4 is adopted for other reasons. |
| `chokidar` | high | via `tailwindcss`; file watching | Accepted. Runs in the dev server and build only. |
| `fast-glob` | high | via `tailwindcss`/`globby`; glob matching | Accepted. Build-time. |
| `micromatch` | high | via `fast-glob`; pattern matching | Accepted. Build-time. |
| `braces` | high | via `chokidar`/`micromatch`; nested pattern expansion | Accepted. Build-time. |
| `globby` | high | via `@sanity/codegen` | Accepted. Studio codegen tooling. |
| `@sanity/cli` | high | `apps/studio` tooling; pulls `@sanity/codegen`, `@sanity/runtime-cli`, `@vercel/frameworks`, `typeid-js` | Accepted. Schema deploy, seed and local dev only. `npm ls` from `apps/web` returns empty for the whole chain. |
| `@sanity/codegen` | high | via `sanity` | Accepted. Studio codegen. |
| `@sanity/runtime-cli` | high | via `sanity` | Accepted. Studio runtime tooling. |
| `sanity` | moderate | `apps/studio` dependency, pulls `@sanity/cli` | Accepted. Compiles to static output. |
| `adm-zip` | high (GHSA-xcpc-8h2w-3j85) | via `@sanity/runtime-cli`; archive extraction | Accepted. Runs when a schema bundle is installed locally, not while serving. Residual: a crafted archive in a local install could exhaust memory. Not reachable from a request. |
| `js-yaml` | high (GHSA-mh29-5h37-fv8m) | via `@vercel/frameworks`; YAML merge prototype pollution | Accepted. Build-time config parsing. Residual: only parses this project's own build configuration. |
| `postcss-nested` | moderate | via `tailwindcss` | Accepted. Build-time CSS transform. |
| `postcss-selector-parser` | moderate | via `postcss-nested`; quadratic selector parsing | Accepted. Build-time; parses this project's own CSS. |
| `@vercel/frameworks` | moderate | via `@sanity/cli` | Accepted. Studio build tooling. |
| `typeid-js` | moderate | via `@sanity/cli` | Accepted. Studio build tooling. |
| `uuid` | moderate (GHSA-w5hq-g745-h8pq) | via `typeid-js`; missing bounds check in v3/v5/v6 **when a caller supplies a buffer** | Accepted. `@sanity/cli` uses `typeid-js` for id generation without a caller-supplied buffer. Residual noted rather than dismissed. |
| `argparse` | moderate | via `js-yaml` | Accepted. Build-time. |
| `sprintf-js` | moderate | via `argparse`; unbounded precision specifiers | Accepted. Build-time, used by a CLI help formatter. |
| `smol-toml` | moderate | via `@sanity/cli`; quadratic `parse()` | Accepted. Studio build tooling. Parses small static config only. |

## Re-audit

`npm run audit:deps` fails when any advisory lacks a row above, so this table
cannot silently fall behind the lockfile. Run it after any dependency change.

## References

- [Parity matrix](parity-tests.md) — P-109
- [Threat model](threat-model.md)
- [Security policy](../../SECURITY.md)