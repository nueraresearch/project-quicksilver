// Dependency advisory gate for parity item P-109.
//
// P-109 requires that no high-severity advisory sits in a runtime dependency
// path, and that every advisory has a recorded decision. `npm audit` alone
// cannot answer the first question in an npm workspace: dev and production
// dependencies are hoisted into one node_modules tree, so a dev-only tool is
// reported exactly like a shipped one.
//
// This script separates the two. It walks the production dependency tree
// (`npm ls --omit=dev --all`) and intersects the names it finds with the
// advisories `npm audit` reports. A high-severity advisory that appears in the
// production tree fails the run; one that only appears through devDependencies
// is recorded as build-time and left to the decision record.
//
// Usage: node scripts/dependency-audit.mjs [--json]

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const decisionRecord = join(repoRoot, 'docs', 'platform', 'dependency-advisories.md')
const BLOCKING_SEVERITIES = new Set(['high', 'critical'])

function run(args, { allowFailure = false } = {}) {
  const result = spawnSync('npm', args, { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  // npm writes reports to stdout but returns non-zero when it finds advisories,
  // so a non-zero exit with parsable output is expected, not a failure.
  if (!allowFailure && result.status !== 0 && !stdout.trim()) {
    throw new Error(`npm ${args.join(' ')} failed: ${stderr || result.status}`)
  }
  return stdout
}

function parseAdvisories() {
  const raw = run(['audit', '--json'], { allowFailure: true })
  if (!raw.trim()) return new Map()
  const parsed = JSON.parse(raw)
  const advisories = new Map()
  for (const [name, entry] of Object.entries(parsed.vulnerabilities ?? {})) {
    const title = (entry.via ?? []).find((via) => typeof via !== 'string')
    advisories.set(name, {
      name,
      severity: entry.severity,
      range: entry.range,
      direct: Boolean(entry.isDirect),
      title: title?.title ?? entry.via?.find((via) => typeof via === 'string') ?? 'advisory',
      url: title?.url ?? '',
    })
  }
  return advisories
}

function parseDecisions() {
  let text
  try {
    text = readFileSync(decisionRecord, 'utf8')
  } catch {
    return new Set()
  }
  const decided = new Set()
  // Each recorded decision is a table row whose first cell is `| \`name\` |`.
  for (const line of text.split('\n')) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|/)
    if (match) decided.add(match[1])
  }
  return decided
}

// Workspaces whose dependencies run while serving requests.
//
// apps/studio is deliberately excluded. Sanity Studio compiles to static
// output that is uploaded and served as files; `sanity` and `@sanity/cli` run
// during schema deploy, seeding and local development, and are not part of the
// artifact a browser or the host executes. Its advisories are build-time and
// are tracked in the decision record instead.
//
// apps/web (Vercel) and packages/* (the Render host) do serve requests, so
// their trees are the ones P-109 constrains.
const SERVING_WORKSPACES = ['apps/web', 'packages/kernel', 'packages/agent', 'packages/host', 'packages/aura', 'packages/operator', 'packages/sdk', 'packages/sdk-go', 'packages/sdk-python']

function collectProductionPackages() {
  const into = new Set()
  for (const workspace of SERVING_WORKSPACES) {
    if (workspace.endsWith('.json')) continue
    const raw = run(['ls', '--omit=dev', '--all', '--json', '--workspace', workspace], { allowFailure: true })
    if (!raw.trim()) continue
    try {
      collectProductionPackagesInTree(JSON.parse(raw), into)
    } catch {
      // A workspace without installed dependencies is not a failure for this gate.
    }
  }
  return into
}

function collectProductionPackagesInTree(node, into) {
  if (!node || typeof node !== 'object') return into
  const dependencies = node.dependencies
  if (!dependencies) return into
  for (const [name, child] of Object.entries(dependencies)) {
    into.add(name)
    collectProductionPackagesInTree(child, into)
  }
  return into
}

const advisories = parseAdvisories()
const production = collectProductionPackages()
const decisions = parseDecisions()

const runtimeBlockers = []
const buildTime = []
const undecided = []

for (const advisory of advisories.values()) {
  const inProduction = production.has(advisory.name)
  if (inProduction && BLOCKING_SEVERITIES.has(advisory.severity)) runtimeBlockers.push(advisory)
  else if (inProduction) buildTime.push({ ...advisory, class: 'runtime, below threshold' })
  else buildTime.push({ ...advisory, class: 'build-time only' })
  if (!decisions.has(advisory.name)) undecided.push(advisory)
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    runtimeBlockers: runtimeBlockers.map((a) => a.name),
    buildTime: buildTime.map((a) => a.name),
    undecided: undecided.map((a) => a.name),
    total: advisories.size,
  }, null, 2))
} else {
  console.log(`advisories reported by npm audit : ${advisories.size}`)
  console.log(`production dependency packages  : ${production.size}`)
  console.log(`runtime high/critical blockers  : ${runtimeBlockers.length}`)
  console.log(`build-time or below threshold   : ${buildTime.length}`)
  console.log(`advisories with no recorded decision: ${undecided.length}`)
}

let failed = false
if (runtimeBlockers.length > 0) {
  failed = true
  console.error('\nHIGH-SEVERITY ADVISORY IN A RUNTIME DEPENDENCY PATH (P-109):')
  for (const advisory of runtimeBlockers) {
    console.error(`  ${advisory.name}@${advisory.range} — ${advisory.title}`)
    if (advisory.url) console.error(`    ${advisory.url}`)
  }
  console.error('\nUpgrade the dependency, or pin a non-vulnerable range with an npm override.')
}

if (undecided.length > 0) {
  failed = true
  console.error('\nADVISORY WITH NO RECORDED DECISION (P-109 requires one of each):')
  for (const advisory of undecided) console.error(`  ${advisory.name} — ${advisory.title}`)
  console.error(`\nRecord each in ${decisionRecord} with its runtime/build-time class and rationale.`)
}

process.exit(failed ? 1 : 0)