#!/usr/bin/env node
/**
 * C0 public ownership manifest gate.
 *
 * The C0 procedure produces a redacted public ownership manifest. This gate
 * refuses a manifest that is structurally invalid, carries a private field or
 * an unknown source/evidence name, disagrees with its own totals, or claims
 * `signed` while a blocker or a false check remains. It also verifies the
 * manifest digest and sign-off statement digest.
 *
 *   node scripts/native-c0-gate.mjs <manifest.json> [--json]
 *
 * Exit 0 only for a structurally valid, signed, zero-blocker manifest. Exit 1
 * for a valid `blocked` manifest. Exit 2 for invalid or unreadable input.
 *
 * What this does not prove: ownership, signature authenticity, the private
 * ownership pack, the source export, or that a tenant authority approved an
 * individual record. Those remain the sign-off steps in the C0 procedure. A
 * green result here is a precondition, not C0 exit.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const SCHEMA_VERSION = 'c0-ownership-v1'
const TOP_FIELDS = [
  'schemaVersion',
  'status',
  'baselineId',
  'generatedAt',
  'scopeDigest',
  'sourceContentDigest',
  'ownershipPackDigest',
  'records',
  'assets',
  'aliases',
  'evidence',
  'checks',
  'signoff',
]
const RECORD_STATUSES = ['confirmed', 'candidate', 'ambiguous', 'unresolved', 'retired', 'blocked']
const ASSET_DISPOSITIONS = ['exclusive', 'copiesRequired', 'shared', 'globalOrphan', 'blocked']
const CHECK_FIELDS = [
  'zeroAmbiguous',
  'zeroUnresolved',
  'zeroBlocked',
  'allCandidatesResolved',
  'allAliasesDecided',
  'rootOrganizationsConfirmed',
  'sharedAssetSetsApproved',
  'principalBindingsValidated',
  'noPrivateData',
  'digestsVerify',
]
const SIGNOFF_FIELDS = ['role', 'signedAt', 'statement', 'statementDigest', 'manifestDigest', 'signature']
// Checks that restate an aggregate above. `validateChecks` forces each to match
// that aggregate, so a false one is reported once as the underlying count.
const DERIVED_CHECKS = ['zeroAmbiguous', 'zeroUnresolved', 'zeroBlocked', 'allCandidatesResolved', 'allAliasesDecided']
const ASSERTED_CHECKS = CHECK_FIELDS.filter((field) => !DERIVED_CHECKS.includes(field))
const SIGNOFF_STATEMENT =
  'I confirm, for the named C0 baseline, that every retained content record is confirmed to exactly one tenant or retired by an owner-approved decision; every alias is approved or rejected; every shared asset has an exact approved tenant set and a confirmed grant for every entitled tenant; every principal binding was validated; and the redacted manifest contains no private data. I confirm that no ownership was assigned from an environment default, display name, slug, filename, uploader, hash, seed fixture, or reference agreement alone.'

// The 36 registered source types in the C0 inventory. `bySourceType` is public,
// so accepting an arbitrary key would let a tenant name or asset identifier
// become an aggregate label. A new schema type must be added here and in C0.
const SOURCE_TYPES = new Set([
  'organization',
  'department',
  'departmentExecutionAudit',
  'entity',
  'capability',
  'policy',
  'objective',
  'workflow',
  'automationWorkflow',
  'workflowPublicationHead',
  'workflowPublicationAudit',
  'workflowExecution',
  'evidence',
  'decision',
  'metric',
  'evaluationRecord',
  'intentGraph',
  'intentLedgerEntry',
  'playbook',
  'shadowRecommendation',
  'auraVerdictLearner',
  'moneyEntry',
  'experimentRecord',
  'contentReview',
  'agentDefinition',
  'agentPublicationAudit',
  'agentPublicationHead',
  'authorizationDecisionAudit',
  'telemetryTraceSpan',
  'oidcLoginTransaction',
  'oidcWebSession',
  'commitment',
  'contact',
  'review',
  'scheduledItem',
  'draftedCommunication',
])
const EVIDENCE_TYPES = new Set([
  'sourceTenant',
  'tenantAlias',
  'recordMapping',
  'typeWideRule',
  'referenceClosure',
  'ownerAttestation',
  'assetReferenceSet',
])

class GateInputError extends Error {}

function fail(message) {
  throw new GateInputError(message)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactFields(value, fields, at) {
  if (!isObject(value)) fail(`${at} must be an object`)
  const missing = fields.filter((field) => !Object.hasOwn(value, field))
  if (missing.length) fail(`${at} is missing required fields: ${missing.join(', ')}`)
  const extra = Object.keys(value).filter((field) => !fields.includes(field))
  if (extra.length) fail(`${at} contains ${extra.length} field(s) outside the public manifest schema`)
}

function nonNegativeInteger(value, at) {
  if (!Number.isInteger(value) || value < 0) fail(`${at} must be a non-negative integer`)
}

function boolean(value, at) {
  if (typeof value !== 'boolean') fail(`${at} must be true or false`)
}

function digestHex(value, at) {
  if (typeof value !== 'string') fail(`${at} must be a SHA-256 digest`)
  const match = /^(?:sha256:)?([0-9a-f]{64})$/.exec(value)
  if (!match) fail(`${at} must be a SHA-256 digest`)
  return match[1]
}

function timestamp(value, at) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    fail(`${at} must be an ISO-8601 UTC timestamp`)
  }
  if (Number.isNaN(Date.parse(value))) fail(`${at} is not a real timestamp`)
}

function baselineId(value, at) {
  // A v4 UUID is random and carries no tenant, dataset, date, slug, or name.
  // A name-derived UUID (v3/v5) or a readable identifier is not opaque.
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    fail(`${at} must be a random UUID v4`)
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function digestJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function digestText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function validateRecords(records) {
  const at = 'records'
  exactFields(records, ['total', 'byStatus', 'bySourceType'], at)
  nonNegativeInteger(records.total, `${at}.total`)
  exactFields(records.byStatus, RECORD_STATUSES, `${at}.byStatus`)
  for (const status of RECORD_STATUSES) nonNegativeInteger(records.byStatus[status], `${at}.byStatus.${status}`)

  const statusSum = RECORD_STATUSES.reduce((sum, status) => sum + records.byStatus[status], 0)
  if (statusSum !== records.total) fail(`${at}.byStatus does not sum to ${at}.total`)

  if (!isObject(records.bySourceType)) fail(`${at}.bySourceType must be an object`)
  const byTypeSums = Object.fromEntries(RECORD_STATUSES.map((status) => [status, 0]))
  for (const counts of Object.values(records.bySourceType)) {
    exactFields(counts, RECORD_STATUSES, `${at}.bySourceType entry`)
    for (const status of RECORD_STATUSES) {
      nonNegativeInteger(counts[status], `${at}.bySourceType entry.${status}`)
      byTypeSums[status] += counts[status]
    }
  }
  for (const type of Object.keys(records.bySourceType)) {
    if (!SOURCE_TYPES.has(type)) {
      // Do not echo the key: an invalid key may itself be a tenant or asset name.
      fail(`${at}.bySourceType contains a source type outside the 36-type C0 inventory`)
    }
  }
  for (const status of RECORD_STATUSES) {
    if (byTypeSums[status] !== records.byStatus[status]) {
      fail(`${at}.bySourceType does not sum to ${at}.byStatus.${status}`)
    }
  }
}

function validateAssets(assets) {
  const at = 'assets'
  exactFields(assets, ['total', 'byDisposition', 'sharedGrants', 'globalGrants'], at)
  nonNegativeInteger(assets.total, `${at}.total`)
  exactFields(assets.byDisposition, ASSET_DISPOSITIONS, `${at}.byDisposition`)
  let sum = 0
  for (const disposition of ASSET_DISPOSITIONS) {
    nonNegativeInteger(assets.byDisposition[disposition], `${at}.byDisposition.${disposition}`)
    sum += assets.byDisposition[disposition]
  }
  if (sum !== assets.total) fail(`${at}.byDisposition does not sum to ${at}.total`)
  nonNegativeInteger(assets.sharedGrants, `${at}.sharedGrants`)
  nonNegativeInteger(assets.globalGrants, `${at}.globalGrants`)
  if (assets.byDisposition.shared > 0 && assets.sharedGrants < assets.byDisposition.shared) {
    fail(`${at}.sharedGrants is smaller than the shared asset count`)
  }
}

function validateAliases(aliases) {
  const at = 'aliases'
  exactFields(aliases, ['approved', 'rejected', 'pending', 'conflicts'], at)
  for (const field of ['approved', 'rejected', 'pending', 'conflicts']) {
    nonNegativeInteger(aliases[field], `${at}.${field}`)
  }
}

function validateEvidence(evidence) {
  const at = 'evidence'
  exactFields(evidence, ['byType', 'missing', 'conflicts'], at)
  if (!isObject(evidence.byType)) fail(`${at}.byType must be an object`)
  for (const [type, count] of Object.entries(evidence.byType)) {
    if (!EVIDENCE_TYPES.has(type)) {
      fail(`${at}.byType contains an evidence class outside the public manifest schema`)
    }
    nonNegativeInteger(count, `${at}.byType entry`)
  }
  nonNegativeInteger(evidence.missing, `${at}.missing`)
  nonNegativeInteger(evidence.conflicts, `${at}.conflicts`)
}

function validateChecks(checks, manifest) {
  exactFields(checks, CHECK_FIELDS, 'checks')
  for (const field of CHECK_FIELDS) boolean(checks[field], `checks.${field}`)

  const derived = {
    zeroAmbiguous: manifest.records.byStatus.ambiguous === 0,
    zeroUnresolved: manifest.records.byStatus.unresolved === 0,
    zeroBlocked: manifest.records.byStatus.blocked === 0,
    allCandidatesResolved: manifest.records.byStatus.candidate === 0,
    allAliasesDecided: manifest.aliases.pending === 0 && manifest.aliases.conflicts === 0,
  }
  for (const [field, expected] of Object.entries(derived)) {
    if (checks[field] !== expected) fail(`checks.${field} disagrees with the manifest aggregates`)
  }
}

function validateSignoff(signoff) {
  if (signoff === null) return null
  exactFields(signoff, SIGNOFF_FIELDS, 'signoff')
  if (signoff.role !== 'Product Owner') fail('signoff.role must be Product Owner')
  timestamp(signoff.signedAt, 'signoff.signedAt')
  if (signoff.statement !== SIGNOFF_STATEMENT) fail('signoff.statement does not match the C0 sign-off statement')
  if (typeof signoff.signature !== 'string' || !signoff.signature.trim() || signoff.signature.length > 16384) {
    fail('signoff.signature must be a non-empty opaque signature')
  }
  return {
    manifestDigest: digestHex(signoff.manifestDigest, 'signoff.manifestDigest'),
    statementDigest: digestHex(signoff.statementDigest, 'signoff.statementDigest'),
  }
}

function blockersOf(manifest) {
  const blockers = []
  const records = manifest.records.byStatus
  for (const status of ['ambiguous', 'unresolved', 'blocked', 'candidate']) {
    if (records[status] > 0) blockers.push(`${records[status]} ${status} record(s)`)
  }
  if (manifest.aliases.pending > 0) blockers.push(`${manifest.aliases.pending} pending alias(es)`)
  if (manifest.aliases.conflicts > 0) blockers.push(`${manifest.aliases.conflicts} alias conflict(s)`)
  if (manifest.evidence.missing > 0) blockers.push(`${manifest.evidence.missing} missing evidence reference(s)`)
  if (manifest.evidence.conflicts > 0) blockers.push(`${manifest.evidence.conflicts} evidence conflict(s)`)
  for (const field of ASSERTED_CHECKS) {
    if (!manifest.checks[field]) blockers.push(`check ${field} is false`)
  }
  return blockers
}

function validate(doc) {
  exactFields(doc, TOP_FIELDS, 'manifest')
  if (doc.schemaVersion !== SCHEMA_VERSION) fail(`schemaVersion must be ${SCHEMA_VERSION}`)
  if (!['blocked', 'signed'].includes(doc.status)) fail('status must be blocked or signed')
  baselineId(doc.baselineId, 'baselineId')
  timestamp(doc.generatedAt, 'generatedAt')
  digestHex(doc.scopeDigest, 'scopeDigest')
  digestHex(doc.sourceContentDigest, 'sourceContentDigest')
  digestHex(doc.ownershipPackDigest, 'ownershipPackDigest')
  validateRecords(doc.records)
  validateAssets(doc.assets)
  validateAliases(doc.aliases)
  validateEvidence(doc.evidence)
  validateChecks(doc.checks, doc)
  const signoff = validateSignoff(doc.signoff)

  if (doc.status === 'blocked') {
    if (doc.signoff !== null) fail('a blocked manifest must not carry a signoff')
    return 1
  }

  const blockers = blockersOf(doc)
  if (blockers.length) fail(`a signed manifest cannot carry blockers: ${blockers.join('; ')}`)
  if (!signoff) fail('a signed manifest requires a signoff')

  const unsigned = { ...doc }
  delete unsigned.signoff
  if (signoff.manifestDigest !== digestJson(unsigned)) {
    fail('signoff.manifestDigest does not match the manifest with signoff omitted')
  }
  if (signoff.statementDigest !== digestText(SIGNOFF_STATEMENT)) {
    fail('signoff.statementDigest does not match the C0 sign-off statement')
  }
  return 0
}

function load(file) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    fail(`cannot read ${file}: ${error.code === 'ENOENT' ? 'does not exist' : error.code ?? 'unreadable'}`)
  }
  if (!raw.trim()) fail(`${file} is empty`)
  let doc
  try {
    doc = JSON.parse(raw)
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`)
  }
  return doc
}

function summary(doc, outcome) {
  return {
    schemaVersion: doc.schemaVersion,
    status: doc.status,
    accepted: outcome === 0,
    records: {
      total: doc.records.total,
      ambiguous: doc.records.byStatus.ambiguous,
      unresolved: doc.records.byStatus.unresolved,
      blocked: doc.records.byStatus.blocked,
      candidate: doc.records.byStatus.candidate,
      retired: doc.records.byStatus.retired,
    },
    aliases: doc.aliases,
    evidence: { missing: doc.evidence.missing, conflicts: doc.evidence.conflicts },
    blockers: outcome === 0 ? [] : blockersOf(doc),
  }
}

function main() {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const file = args.find((arg) => !arg.startsWith('--'))
  if (!file) fail('usage: native-c0-gate <manifest.json> [--json]')

  const doc = load(file)
  const outcome = validate(doc)
  const result = summary(doc, outcome)

  if (json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`C0 public ownership manifest (${doc.schemaVersion})`)
    console.log(
      `records: ${result.records.total} total; ${result.records.ambiguous} ambiguous, ${result.records.unresolved} unresolved, ${result.records.blocked} blocked, ${result.records.candidate} candidate, ${result.records.retired} retired`,
    )
    console.log(`aliases: ${result.aliases.approved} approved, ${result.aliases.rejected} rejected, ${result.aliases.pending} pending, ${result.aliases.conflicts} conflict(s)`)
    console.log(`evidence: ${result.evidence.missing} missing, ${result.evidence.conflicts} conflict(s)`)
    if (outcome === 0) {
      console.log('\nC0 PUBLIC MANIFEST ACCEPTED: signed, zero blockers, digests match.')
      console.log('This is a structural gate only. It does not verify the signature, private pack, source export, or ownership decisions.')
    } else {
      console.log('\nC0 GATE BLOCKED: the manifest is structurally valid but not signed and clear.')
      for (const blocker of result.blockers) console.log(`  - ${blocker}`)
      console.log('This is not C0 exit. Resolve every blocker and sign the exact public manifest.')
    }
  }

  process.exitCode = outcome
}

try {
  main()
} catch (error) {
  if (error instanceof GateInputError) {
    console.error(`C0 PUBLIC MANIFEST FAILED (input): ${error.message}`)
    console.error('This is not a pass. Do not sign or import from this manifest.')
    process.exit(2)
  }
  throw error
}
