#!/usr/bin/env node
/**
 * The default-backend removal gate (native plan, Stage 1/2).
 *
 * Reads the versioned capability matrix and refuses to pass while any core
 * capability is not native. Fail-closed: a missing, empty, malformed or
 * evidence-less matrix exits 2, not 0. A blocked gate exits 1 and prints each
 * blocker with its gap, so the reason is actionable rather than a count.
 *
 *   node scripts/native-capability-matrix.mjs [matrix.json] [--json]
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const STATUSES = new Set(['native', 'partial', 'absent'])
const TEST_EVIDENCE = /\.(test|spec)\.(?:ts|tsx|mjs|cjs|js)$/

class GateInputError extends Error {}

const SCOPES = new Set(['global', 'content'])

const USAGE = 'usage: native-capability-matrix.mjs [matrix.json] [--json] [--scope=global|content]'

function fail(message) {
  throw new GateInputError(message)
}

function repoPath(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} must be a non-empty path`)
  if (path.isAbsolute(value)) fail(`${field} must be repository-relative: ${value}`)
  const resolved = path.resolve(process.cwd(), value)
  const relative = path.relative(process.cwd(), resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail(`${field} escapes the repository: ${value}`)
  if (!existsSync(resolved)) fail(`${field} does not exist: ${value}`)
  return relative
}

function validate(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail('matrix must be a JSON object')
  if (!Number.isInteger(doc.version) || doc.version < 1) fail('version must be a positive integer')
  if (typeof doc.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.updated)) fail('updated must be YYYY-MM-DD')
  if (typeof doc.gate !== 'string' || !doc.gate.trim()) fail('gate must name the removal gate')
  if (!Array.isArray(doc.providers) || doc.providers.length === 0) fail('providers must be a non-empty array')
  if (!Array.isArray(doc.capabilities) || doc.capabilities.length === 0) fail('capabilities must be a non-empty array')

  const providerIds = new Set()
  for (const [index, provider] of doc.providers.entries()) {
    if (!provider || typeof provider !== 'object') fail(`providers[${index}] must be an object`)
    if (typeof provider.id !== 'string' || !provider.id.trim()) fail(`providers[${index}].id is required`)
    if (providerIds.has(provider.id)) fail(`duplicate provider id: ${provider.id}`)
    if (!['required', 'optional'].includes(provider.status)) fail(`providers[${index}].status must be required or optional`)
    if (typeof provider.r1 !== 'string' || !provider.r1.trim()) fail(`providers[${index}].r1 is required`)
    providerIds.add(provider.id)
  }

  const capabilityIds = new Set()
  for (const [index, capability] of doc.capabilities.entries()) {
    const at = `capabilities[${index}]`
    if (!capability || typeof capability !== 'object') fail(`${at} must be an object`)
    if (typeof capability.id !== 'string' || !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(capability.id)) fail(`${at}.id must be dotted lowercase`)
    if (capabilityIds.has(capability.id)) fail(`duplicate capability id: ${capability.id}`)
    if (!providerIds.has(capability.provider)) fail(`${at}.provider is not declared: ${capability.provider}`)
    if (typeof capability.feature !== 'string' || !capability.feature.trim()) fail(`${at}.feature is required`)
    if (typeof capability.core !== 'boolean') fail(`${at}.core must be true or false`)
    if (!STATUSES.has(capability.native)) fail(`${at}.native must be native, partial or absent`)
    if (typeof capability.externalRequired !== 'boolean') fail(`${at}.externalRequired must be true or false`)
    if (!Array.isArray(capability.evidence) || capability.evidence.length === 0) fail(`${at}.evidence must be a non-empty array`)
    for (const evidence of capability.evidence) repoPath(evidence, `${at}.evidence`)
    if (capability.native === 'native') {
      if (capability.externalRequired) fail(`${at} claims native and externalRequired; a native capability cannot need an external account`)
      if (!capability.evidence.some((evidence) => TEST_EVIDENCE.test(evidence))) {
        fail(`${at} claims native without a test as evidence`)
      }
    }
    if (typeof capability.gaps !== 'string') fail(`${at}.gaps must be a string`)
    if (typeof capability.r1 !== 'string' || !capability.r1.trim()) fail(`${at}.r1 is required`)
    capabilityIds.add(capability.id)
  }
}

function load(file) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    fail(`cannot read ${file}: ${error.code ?? 'unreadable'}`)
  }
  if (!raw.trim()) fail(`${file} is empty`)
  let doc
  try {
    doc = JSON.parse(raw)
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`)
  }
  validate(doc)
  return doc
}

function main() {
  const args = process.argv.slice(2)
  const flags = args.filter((arg) => arg.startsWith('-'))
  const positional = args.filter((arg) => !arg.startsWith('-'))
  const scopeFlags = flags.filter((flag) => flag === '--scope' || flag.startsWith('--scope='))
  const unknown = flags.filter((flag) => flag !== '--json' && !scopeFlags.includes(flag))
  if (unknown.length > 0) fail(`unknown option ${unknown.join(', ')}; ${USAGE}`)
  if (scopeFlags.length > 1) fail(`--scope may be given once; ${USAGE}`)
  if (positional.length > 1) fail(`unexpected argument ${positional.slice(1).join(', ')}; ${USAGE}`)
  const json = flags.includes('--json')
  const scope = scopeFlags.length === 0
    ? 'global'
    : scopeFlags[0].includes('=')
      ? scopeFlags[0].slice(scopeFlags[0].indexOf('=') + 1)
      : ''
  if (!SCOPES.has(scope)) fail(`unknown scope ${scope === '' ? '(missing)' : scope}; expected global or content`)
  const doc = load(positional[0] ?? 'docs/platform/native-capabilities.json')

  const inScope = (capability) => scope === 'global' || capability.id.startsWith('content.')
  const core = doc.capabilities.filter((capability) => capability.core && inScope(capability))
  if (core.length === 0) fail(`scope ${scope} matched no core capabilities; an empty scope is not a pass`)
  const optional = doc.capabilities.filter((capability) => !capability.core)
  const count = (rows, status) => rows.filter((row) => row.native === status).length
  const blockers = core.filter((capability) => capability.native !== 'native')
  const summary = {
    version: doc.version,
    updated: doc.updated,
    gate: doc.gate,
    scope,
    core: core.length,
    optional: optional.length,
    native: count(core, 'native'),
    partial: count(core, 'partial'),
    absent: count(core, 'absent'),
    blockers: blockers.map((capability) => ({
      id: capability.id,
      provider: capability.provider,
      native: capability.native,
      gap: capability.gaps,
    })),
    passed: blockers.length === 0,
  }

  if (json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(`Native capability matrix v${doc.version} (${doc.updated}) - ${doc.gate} [scope: ${scope}]`)
    console.log(`core: ${summary.core} (native ${summary.native}, partial ${summary.partial}, absent ${summary.absent}); optional: ${summary.optional}`)
    const label = scope === 'content' ? 'CONTENT PARITY GATE' : 'REMOVAL GATE'
    const noun = scope === 'content' ? 'content' : 'core'
    if (blockers.length) {
      console.log(`\n${label} BLOCKED: ${blockers.length} of ${core.length} ${noun} capabilities are not native.`)
      for (const capability of blockers) {
        console.log(`  - ${capability.id} [${capability.provider}/${capability.native}]: ${capability.gaps}`)
      }
      console.log(scope === 'content'
        ? '\nThis is not a pass, and it is not a provider retirement: content parity is a milestone. Sanity, OIDC, Resend and hosted-model keep their current status until the global gate passes (ADR 0006).'
        : '\nThis is not a pass. Sanity, OIDC, Resend and hosted-model defaults may not be retired while any row above is not native (R1).')
    } else if (scope === 'content') {
      console.log(`\nCONTENT PARITY GATE PASSED: all ${core.length} content capabilities are native. Provider status is unchanged; removal is still the global gate (ADR 0006).`)
    } else {
      console.log(`\nREMOVAL GATE PASSED: all ${core.length} core capabilities are native.`)
    }
  }

  process.exitCode = blockers.length === 0 ? 0 : 1
}

try {
  main()
} catch (error) {
  if (error instanceof GateInputError) {
    console.error(`NATIVE CAPABILITY MATRIX FAILED (input): ${error.message}`)
    console.error('This is not a pass.')
    process.exit(2)
  }
  throw error
}
