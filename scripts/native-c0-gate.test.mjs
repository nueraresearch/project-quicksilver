import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const script = path.resolve('scripts/native-c0-gate.mjs')
const root = process.cwd()
const temp = mkdtempSync(path.join(tmpdir(), 'native-c0-gate-'))
after(() => rmSync(temp, { recursive: true, force: true }))

const env = { ...process.env }
delete env.NODE_TEST_CONTEXT

const statement =
  'I confirm, for the named C0 baseline, that every retained content record is confirmed to exactly one tenant or retired by an owner-approved decision; every alias is approved or rejected; every shared asset has an exact approved tenant set and a confirmed grant for every entitled tenant; every principal binding was validated; and the redacted manifest contains no private data. I confirm that no ownership was assigned from an environment default, display name, slug, filename, uploader, hash, seed fixture, or reference agreement alone.'

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function baseManifest() {
  return {
    schemaVersion: 'c0-ownership-v1',
    status: 'blocked',
    baselineId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    generatedAt: '2026-11-17T00:00:00Z',
    scopeDigest: `sha256:${'a'.repeat(64)}`,
    sourceContentDigest: 'b'.repeat(64),
    ownershipPackDigest: `sha256:${'c'.repeat(64)}`,
    records: {
      total: 2,
      byStatus: {
        confirmed: 2,
        candidate: 0,
        ambiguous: 0,
        unresolved: 0,
        retired: 0,
        blocked: 0,
      },
      bySourceType: {
        decision: {
          confirmed: 2,
          candidate: 0,
          ambiguous: 0,
          unresolved: 0,
          retired: 0,
          blocked: 0,
        },
      },
    },
    assets: {
      total: 0,
      byDisposition: {
        exclusive: 0,
        copiesRequired: 0,
        shared: 0,
        globalOrphan: 0,
        blocked: 0,
      },
      sharedGrants: 0,
      globalGrants: 0,
    },
    aliases: { approved: 0, rejected: 0, pending: 0, conflicts: 0 },
    evidence: { byType: { sourceTenant: 2 }, missing: 0, conflicts: 0 },
    checks: {
      zeroAmbiguous: true,
      zeroUnresolved: true,
      zeroBlocked: true,
      allCandidatesResolved: true,
      allAliasesDecided: true,
      rootOrganizationsConfirmed: true,
      sharedAssetSetsApproved: true,
      principalBindingsValidated: true,
      noPrivateData: true,
      digestsVerify: true,
    },
    signoff: null,
  }
}

function signed(manifest) {
  const unsigned = { ...manifest, status: 'signed' }
  delete unsigned.signoff
  return {
    ...unsigned,
    signoff: {
      role: 'Product Owner',
      signedAt: '2026-11-17T01:00:00Z',
      statement,
      statementDigest: `sha256:${hashText(statement)}`,
      manifestDigest: `sha256:${hashJson(unsigned)}`,
      signature: 'opaque-signature',
    },
  }
}

function fixture(name, manifest) {
  const file = path.join(temp, name)
  writeFileSync(file, typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2))
  return file
}

function run(file, args = []) {
  return spawnSync(process.execPath, [script, file, ...args], { cwd: root, env, encoding: 'utf8' })
}

test('a signed zero-blocker manifest passes', () => {
  const result = run(fixture('signed.json', signed(baseManifest())))
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /C0 PUBLIC MANIFEST ACCEPTED/)
  assert.match(result.stdout, /structural gate only/)
})

test('a structurally valid blocked manifest exits 1 and names the blocker', () => {
  const manifest = baseManifest()
  manifest.records.byStatus = {
    confirmed: 1,
    candidate: 0,
    ambiguous: 0,
    unresolved: 1,
    retired: 0,
    blocked: 0,
  }
  manifest.records.bySourceType.decision = { ...manifest.records.byStatus }
  manifest.checks.zeroUnresolved = false
  const result = run(fixture('blocked.json', manifest))
  assert.equal(result.status, 1)
  assert.match(result.stdout, /C0 GATE BLOCKED/)
  assert.match(result.stdout, /1 unresolved record/)
})

test('a signed manifest with a candidate is invalid, not accepted', () => {
  const manifest = baseManifest()
  manifest.records.byStatus = {
    confirmed: 1,
    candidate: 1,
    ambiguous: 0,
    unresolved: 0,
    retired: 0,
    blocked: 0,
  }
  manifest.records.bySourceType.decision = { ...manifest.records.byStatus }
  manifest.checks.allCandidatesResolved = false
  const result = run(fixture('candidate-signed.json', signed(manifest)))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /signed manifest cannot carry blockers/)
  assert.doesNotMatch(result.stdout, /ACCEPTED/)
})

test('a pending alias blocks a signed manifest', () => {
  const manifest = baseManifest()
  manifest.aliases.pending = 1
  manifest.checks.allAliasesDecided = false
  const result = run(fixture('alias-pending-signed.json', signed(manifest)))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /pending alias/)
})

test('an unknown source-type key fails without echoing the key', () => {
  const manifest = baseManifest()
  manifest.records.bySourceType['tenant-secret-name'] = {
    confirmed: 0,
    candidate: 0,
    ambiguous: 0,
    unresolved: 0,
    retired: 0,
    blocked: 0,
  }
  const result = run(fixture('unknown-type.json', manifest))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /outside the 36-type C0 inventory/)
  assert.doesNotMatch(result.stderr, /tenant-secret-name/)
})

test('a private field fails without echoing its value', () => {
  const manifest = baseManifest()
  manifest.tenantId = 'private-tenant-value'
  const result = run(fixture('private-field.json', manifest))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /outside the public manifest schema/)
  assert.doesNotMatch(result.stderr, /private-tenant-value/)
})

test('a readable or name-derived baselineId is refused without echoing it', () => {
  const readable = baseManifest()
  readable.baselineId = 'nuera-research-baseline-2026-11-17'
  const readableResult = run(fixture('tenant-like-baseline.json', readable))
  assert.equal(readableResult.status, 2)
  assert.match(readableResult.stderr, /baselineId must be a random UUID v4/)
  assert.doesNotMatch(readableResult.stderr, /nuera-research-baseline/)

  const nameDerived = baseManifest()
  nameDerived.baselineId = '2ed6657d-e927-568b-95e1-2665a8aea6a2'
  const nameDerivedResult = run(fixture('name-derived-uuid.json', nameDerived))
  assert.equal(nameDerivedResult.status, 2)
  assert.match(nameDerivedResult.stderr, /baselineId must be a random UUID v4/)
})

test('an aggregate mismatch is invalid input', () => {
  const manifest = baseManifest()
  manifest.records.total = 3
  const result = run(fixture('total-mismatch.json', manifest))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /does not sum to records.total/)
})

test('a changed manifest invalidates the signoff digest', () => {
  const manifest = signed(baseManifest())
  manifest.scopeDigest = `sha256:${'d'.repeat(64)}`
  const result = run(fixture('digest-mismatch.json', manifest))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /manifestDigest does not match/)
})

test('a signoff by anyone other than the Product Owner fails', () => {
  const manifest = signed(baseManifest())
  manifest.signoff.role = 'Engineering Lead'
  const result = run(fixture('wrong-owner.json', manifest))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /signoff.role must be Product Owner/)
})

test('a blocked manifest cannot carry a signoff', () => {
  const manifest = baseManifest()
  manifest.signoff = signed(baseManifest()).signoff
  const result = run(fixture('blocked-signed.json', manifest))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /blocked manifest must not carry a signoff/)
})

test('an empty or malformed manifest is invalid input', () => {
  const empty = run(fixture('empty.json', ''))
  assert.equal(empty.status, 2)
  assert.match(empty.stderr, /is empty/)

  const malformed = run(fixture('malformed.json', '{"schemaVersion":'))
  assert.equal(malformed.status, 2)
  assert.match(malformed.stderr, /not valid JSON/)
})

test('the JSON summary exposes counts and blockers but no private fields', () => {
  const manifest = baseManifest()
  manifest.records.byStatus = {
    confirmed: 1,
    candidate: 0,
    ambiguous: 0,
    unresolved: 1,
    retired: 0,
    blocked: 0,
  }
  manifest.records.bySourceType.decision = { ...manifest.records.byStatus }
  manifest.checks.zeroUnresolved = false
  const result = run(fixture('summary.json', manifest), ['--json'])
  assert.equal(result.status, 1)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.accepted, false)
  assert.equal(summary.records.unresolved, 1)
  assert.equal(summary.blockers.includes('1 unresolved record(s)'), true)
  assert.deepEqual(Object.keys(summary).sort(), ['accepted', 'aliases', 'blockers', 'evidence', 'records', 'schemaVersion', 'status'])
  assert.deepEqual(Object.keys(summary.records).sort(), ['ambiguous', 'blocked', 'candidate', 'retired', 'total', 'unresolved'])
})
