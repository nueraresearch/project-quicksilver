# Dependency advisory decisions (P-109)

Parity item **P-109** requires two things: no high-severity advisory in a runtime
dependency path, and a recorded decision for every advisory.

`npm run audit:deps` enforces both. It reports what `npm audit` finds, walks the
*production* dependency tree of every serving workspace, and fails when a
high-severity advisory appears in that tree or when an advisory has no decision
recorded below.

If either `npm audit` or `npm ls` produces no parsable report, the gate fails
with `DEPENDENCY AUDIT FAILED (P-109)` instead of treating the missing output
as an empty advisory set or an empty production tree.

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

## Runtime-path advisories: six fixed, zero blocking

Six advisories in serving paths have been fixed: two by pinning a
non-vulnerable version in the root `overrides` block, and four by the
2026-11-10 dependency refresh:

| Package | Advisory | Path | Resolution |
|---|---|---|---|
| `sharp` | GHSA-wq5f-xc86-pv6w | `apps/web → next@16.4.6 → sharp@0.35.4` | Pinned to `0.35.5` |
| `source-map-js` | GHSA-68fv-2mgg-jv7q | `apps/web → next@16.4.6 → postcss → source-map-js@1.2.1` | Pinned to `1.2.2` |
| `next` | GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r | `apps/web → next@16.4.0` | Upgraded to `16.4.6` on 2026-11-10; `npm audit` no longer reports any of the three |
| `body-parser` | GHSA-27r3-jxmh-p828 | `@quicksilver/host → @modelcontextprotocol/sdk → express → body-parser@2.3.0` | Updated to `2.4.0` on 2026-11-10, within `express`’s `^2.2.1` range |
| `undici` | GHSA-2m5v-pch6-74hx, GHSA-f72v-6w45-q472, GHSA-4qv8-2p9j-2685 | `@quicksilver/agent → @ai-sdk/provider-utils → undici@6.28.1 / 7.30.0` | Updated within range to `6.29.1` and `7.30.1` on 2026-11-10 |
| `zod` | GHSA-mrhx-c7xc-m3w5 | Direct dependency of `packages/agent` and `packages/operator` (`zod@3.25.76`) | Upgraded to `^4.6.7` on 2026-11-10; the AI SDK peer range allows `^4.1.8` |

Both were transitive. Neither needed a direct dependency change; both sat
inside ranges (`^0.35.4`, `^1.2.1`) that already permitted the fixed version, so
the lockfile simply had not been updated to the newest allowed patch.

Five advisories remain below the blocking threshold and are accepted with their
residual risk recorded. No high or critical advisory remains in a serving path:
after the 2026-11-14 consolidation, `npm run audit:deps` exits 0 with 0 runtime
blockers and 0 undecided. The exact advisory and production-package counts are not stable
across npm versions and install roots: observed runs reported 21–23 advisories
across 196–198 production packages. npm 10 (Node 22, the CI pin) and npm 11
(Node 26) both report 0 runtime blockers and 0 undecided. The table
above records how the six runtime-path advisories were cleared.

| Package | Severity | Class | Decision |
|---|---|---|---|
| `@hono/node-server` | moderate | `@quicksilver/host → @modelcontextprotocol/sdk → @hono/node-server@2.1.1` | Accepted, below the blocking threshold. `serveStatic` decodes the request path twice, bypassing middleware on static paths (GHSA-rmxm-3fg6-px4f). Residual: only reachable if the MCP transport mounts `serveStatic`; the host's own route table does not serve static files through it. Verify at the next MCP SDK upgrade and take the fix with that bump. |
| `hono` | moderate | `@quicksilver/host → @modelcontextprotocol/sdk → hono@4.13.9` | Accepted, the same advisory through Hono's own `serveStatic`. Residual: a static-path middleware bypass if a Hono app is mounted; not reachable from the host's current routes. Upgrade with `@hono/node-server`. |
| `fast-uri` | moderate | `@quicksilver/host → @modelcontextprotocol/sdk → ajv → fast-uri@3.1.8` (and a dev copy under `apps/web`) | Accepted. Scheme and host confusion in URI parsing. Residual: Ajv uses it to resolve `$id` and references while compiling schemas, not to parse caller URIs at request time; exploiting it needs a crafted schema, not a request. Revisit with the Ajv/MCP SDK refresh. |
| `ip-address` | moderate | `@quicksilver/host → @modelcontextprotocol/sdk → express-rate-limit → ip-address@10.7.2` | Accepted. Quadratic matching on an IPv6 zone identifier (GHSA-rxp7-6hxx-x8q5). Residual: rate limiting parses the client address on every request, so a long malformed address supplied through the trusted forwarding header could stall a worker. The host trusts the platform proxy for that header; keep that boundary and upgrade with `express-rate-limit`. |
| `qs` | moderate | `@quicksilver/host → @modelcontextprotocol/sdk → express → qs@6.16.0` | Accepted. `stringify` throws on an array element with a non-callable own `toString` under `arrayFormat: 'comma'` (GHSA-6pq8-jhm2-2vcw). Residual: the request path uses `qs.parse`, not that stringify mode, so exposure needs code that serializes caller data with comma format; do not add such a call. |

## Remaining advisories: build-time, accepted

Every advisory below is reachable only through development or build tooling and
never executes in a request-serving process. They are accepted, not ignored.

| Package | Severity | Class | Decision |
|---|---|---|---|
| `tailwindcss` | high | devDependency of `apps/web`; pulled `chokidar`, `fast-glob`, `micromatch`, `braces` before v4 | Accepted. Build-time CSS tooling. Tailwind 4.3.3 was adopted on 2026-11-14 as part of the dependency consolidation, and this advisory is no longer reported. The row records the decision for the v3 tree it replaced; the remaining v4 PostCSS dependencies are build-time only. |
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
| `dompurify` | critical | `apps/studio` production dependency via `sanity → @sanity/cli → isomorphic-dompurify`; outside the serving set | Accepted as Studio tooling, conditionally. Three sanitizer bypasses, including SAFE_FOR_TEMPLATES and an IN_PLACE hook that leaves handlers armed (GHSA-cg2g-xh64-v4q7). Residual: a critical sanitizer bypass becomes a runtime finding the moment DOMPurify is bundled into the console or used to sanitize untrusted HTML; nothing in the serving tree loads it today. Re-check before any HTML rendering is added to the console. |
| `markdown-it` | high | `apps/studio` via `sanity → @portabletext/editor → @portabletext/markdown` | Accepted. Quadratic-time parsing and rendering of crafted Markdown (GHSA-gfr2-rv44-r23c). Residual: a crafted document can stall a Studio editor session; no request-serving path parses untrusted Markdown. |
| `vite` | high | `apps/studio` via `sanity → @sanity/cli → @sanity/cli-build → vite@7.3.6` | Accepted. The high advisory is `launch-editor` on Windows (command execution through editor flags); Vite's own entries are dev-server path and filesystem issues. Residual: developer machines running Studio's Vite dev server; that server must not be exposed to an untrusted network. Nothing in the deployed artifact includes Vite. |
| `minimatch` | moderate | `apps/studio` via `sanity → @sanity/cli → @oclif/core` | Accepted. Glob-parts amplification in CLI pattern matching. Residual: a pathological pattern from an operator's own CLI invocation can slow a Studio command; no request path uses it. |
| `@oclif/core` | moderate | `apps/studio` via `sanity → @sanity/cli` | Accepted. The CLI framework inherits the `minimatch` advisory. Residual: Studio command line only; not loaded by the host or the console. |
| `@oclif/plugin-help` | moderate | via `@sanity/cli → @oclif/core` | Accepted. Help plugin behind the same CLI framework; no independent exposure. Residual: none beyond the CLI process. |
| `@oclif/plugin-not-found` | moderate | via `@sanity/cli → @oclif/core` | Accepted. Same CLI framework and the same `minimatch` chain. Residual: none beyond the CLI process. |
| `@sanity/cli-build` | moderate | via `@sanity/cli` | Accepted. Schema and Studio build plumbing. Residual: runs only during schema deploy and local Studio work; no request path. |
| `@sanity/cli-core` | moderate | via `@sanity/cli` and `@sanity/cli-build` | Accepted. CLI core behind the same `minimatch` chain. Residual: Studio command line only. |
| `@sanity/migrate` | moderate | via `sanity` and `@sanity/cli` | Accepted. Migration command run deliberately by an operator. Residual: a crafted migration input could slow the command; it is not a request path. |
| `@sanity-labs/oclif-plugin-skills-flag` | moderate | via `sanity → @sanity/cli`; oclif plugin | Accepted. Studio CLI plugin; runs only during schema deploy and local Studio work. No request path loads it. |
| `@sanity/blueprints` | moderate | via `sanity → @sanity/cli-build` | Accepted. Studio build tooling. Compiles static Studio output; not part of the console or host artifact. |
| `@sanity/vision` | moderate | `apps/studio` dependency; GROQ playground | Accepted. Vision runs inside Studio only, against the dataset the operator can already read. It is not bundled into the serving console or host. |
| `@sanity/workbench-cli` | moderate | via `sanity → @sanity/cli` | Accepted. Studio CLI tooling; no request-serving path. |
| `@sanity/workflow-cli` | moderate | via `sanity → @sanity/cli-core` | Accepted. Studio CLI tooling; no request-serving path. |
| `sanity-plugin-utils` | moderate | via `apps/studio → sanity-plugin-workflow` | Accepted. Studio-only helper library; it is compiled into the static Studio bundle and is not loaded by the serving console or host. |
| `sanity-plugin-workflow` | moderate | `apps/studio` dependency; Studio kanban plugin | Accepted. Studio-only plugin built into static output; no request path imports it. |

## Re-audit

`npm run audit:deps` fails when any advisory lacks a row above, so this table
cannot silently fall behind the lockfile. Run it after any dependency change.
After the 2026-11-14 consolidation every reported advisory has a row, so the
gate's undecided count is 0; with no runtime high/critical advisory left it exits
0 and P-109 is covered. The exact count is npm-version dependent, so verify the
two passing conditions (0 runtime blockers and 0 undecided) rather than a fixed
number. Re-open it if a later audit reports either condition.

## References

- [Parity matrix](parity-tests.md) — P-109
- [Threat model](threat-model.md)
- [Security policy](../../SECURITY.md)