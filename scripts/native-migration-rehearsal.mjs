#!/usr/bin/env node
/**
 * Migration rehearsal for the native cutover (native plan, Stage 1/3).
 *
 * Compares two exported datasets before a cutover, records a snapshot with
 * per-record SHA-256 digests, verifies that snapshot later, and restores it as
 * the rollback path. Records are JSONL objects keyed by a non-empty `_id`.
 *
 *   compare  --source <a.jsonl> --target <b.jsonl>
 *   snapshot --source <a.jsonl> --out <dir>
 *   verify   --snapshot <dir>
 *   restore  --snapshot <dir> --target <file.jsonl>
 *
 * Fail-closed: unreadable, empty, malformed, duplicate-keyed or missing
 * snapshots exit 2; divergence and corruption exit 1. Only a clean comparison
 * or a verified restore exits 0. This proves export-to-export parity, snapshot
 * integrity and rollback mechanics. It does not prove Sanity extraction,
 * tenant isolation, a deployed restart/restore, or owner sign-off.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

class RehearsalInputError extends Error {}

function fail(message) {
  throw new RehearsalInputError(message)
}

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

function digestOf(record) {
  return createHash('sha256').update(JSON.stringify(canonical(record))).digest('hex')
}

function overallDigest(records) {
  const lines = [...records]
    .sort((left, right) => String(left._id).localeCompare(String(right._id)))
    .map((record) => `${record._id}:${digestOf(record)}`)
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

function loadJsonl(file) {
  if (!existsSync(file)) fail(`dataset does not exist: ${file}`)
  const raw = readFileSync(file, 'utf8')
  if (!raw.trim()) fail(`dataset is empty, which is not rehearsal evidence: ${file}`)
  const records = []
  const seen = new Set()
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    let record
    try {
      record = JSON.parse(line)
    } catch (error) {
      fail(`${file}:${index + 1} is not valid JSON: ${error.message}`)
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`${file}:${index + 1} is not an object`)
    if (typeof record._id !== 'string' || !record._id.trim()) fail(`${file}:${index + 1} has no non-empty _id`)
    if (seen.has(record._id)) fail(`${file} repeats _id ${record._id}`)
    seen.add(record._id)
    records.push(record)
  }
  return records
}

function serialise(records) {
  return `${[...records]
    .sort((left, right) => String(left._id).localeCompare(String(right._id)))
    .map((record) => JSON.stringify(canonical(record)))
    .join('\n')}\n`
}

function compare(source, target) {
  const sourceById = new Map(source.map((record) => [record._id, record]))
  const targetById = new Map(target.map((record) => [record._id, record]))
  const missing = [...sourceById.keys()].filter((id) => !targetById.has(id)).sort()
  const extra = [...targetById.keys()].filter((id) => !sourceById.has(id)).sort()
  const changed = [...sourceById.keys()]
    .filter((id) => targetById.has(id) && digestOf(sourceById.get(id)) !== digestOf(targetById.get(id)))
    .sort()
  const sourceDigest = overallDigest(source)
  const targetDigest = overallDigest(target)

  console.log(`source: ${source.length} records, digest ${sourceDigest}`)
  console.log(`target: ${target.length} records, digest ${targetDigest}`)
  if (!missing.length && !extra.length && !changed.length && sourceDigest === targetDigest) {
    console.log(`\nMIGRATION REHEARSAL PARITY OK: ${source.length} records match by id and digest.`)
    return 0
  }

  console.log(`\nMIGRATION REHEARSAL DIVERGED: ${missing.length} missing, ${extra.length} extra, ${changed.length} changed.`)
  for (const id of missing.slice(0, 20)) console.log(`  missing: ${id}`)
  for (const id of extra.slice(0, 20)) console.log(`  extra: ${id}`)
  for (const id of changed.slice(0, 20)) console.log(`  changed: ${id}`)
  console.log('\nThis is not a pass. Resolve every difference before cutover.')
  return 1
}

function snapshot(source, outDir) {
  const manifestPath = path.join(outDir, 'manifest.json')
  const recordsPath = path.join(outDir, 'records.jsonl')
  if (existsSync(manifestPath) || existsSync(recordsPath)) {
    fail(`refusing to overwrite an existing snapshot in ${outDir}; choose a new directory`)
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(recordsPath, serialise(source))
  const manifest = {
    version: 1,
    format: 'quicksilver-native-rehearsal-snapshot',
    createdAt: new Date().toISOString(),
    count: source.length,
    digest: overallDigest(source),
    records: [...source]
      .sort((left, right) => String(left._id).localeCompare(String(right._id)))
      .map((record) => ({ id: record._id, digest: digestOf(record) })),
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`snapshot: ${source.length} records, digest ${manifest.digest}, written to ${outDir}`)
  return 0
}

function readSnapshot(dir) {
  const manifestPath = path.join(dir, 'manifest.json')
  const recordsPath = path.join(dir, 'records.jsonl')
  if (!existsSync(manifestPath)) fail(`snapshot manifest is missing: ${manifestPath}`)
  if (!existsSync(recordsPath)) fail(`snapshot records are missing: ${recordsPath}`)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail(`snapshot manifest is not valid JSON: ${error.message}`)
  }
  if (!manifest || manifest.format !== 'quicksilver-native-rehearsal-snapshot') fail('snapshot manifest format is not recognised')
  if (!Number.isInteger(manifest.count) || manifest.count < 1) fail('snapshot manifest has no positive count')
  if (typeof manifest.digest !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.digest)) fail('snapshot manifest digest is invalid')
  if (!Array.isArray(manifest.records)) fail('snapshot manifest has no record digests')
  const records = loadJsonl(recordsPath)
  return { manifest, records, recordsPath, manifestPath }
}

function verifySnapshot(dir) {
  const { manifest, records } = readSnapshot(dir)
  const digest = overallDigest(records)
  const ids = new Map(records.map((record) => [record._id, digestOf(record)]))
  const manifestIds = new Map(manifest.records.map((entry) => [entry.id, entry.digest]))
  const mismatched = [...manifestIds].filter(([id, expected]) => ids.get(id) !== expected).map(([id]) => id)
  if (records.length !== manifest.count || digest !== manifest.digest || mismatched.length || ids.size !== manifestIds.size) {
    console.log(`SNAPSHOT VERIFY FAILED: ${records.length} records (manifest ${manifest.count}), ${mismatched.length} record digests differ.`)
    console.log('This is not a pass. Do not restore from or cut over on this snapshot.')
    return 1
  }
  console.log(`SNAPSHOT VERIFY OK: ${records.length} records match the manifest digest ${digest}.`)
  return 0
}

function restore(dir, target) {
  const verified = verifySnapshot(dir)
  if (verified !== 0) return verified
  const { records } = readSnapshot(dir)
  writeFileSync(target, serialise(records))
  const restored = loadJsonl(target)
  if (restored.length !== records.length || overallDigest(restored) !== overallDigest(records)) {
    console.log(`RESTORE VERIFY FAILED: ${target} does not match the snapshot after writing.`)
    return 1
  }
  console.log(`RESTORE OK: ${records.length} records written to ${target} and verified against the snapshot digest.`)
  return 0
}

function main() {
  const argv = process.argv.slice(2)
  const mode = argv[0]
  const options = {}
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) fail(`unexpected argument: ${arg}`)
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`missing value for --${key}`)
    options[key] = value
    index += 1
  }

  if (mode === 'compare') {
    if (!options.source || !options.target) fail('compare needs --source and --target')
    return compare(loadJsonl(options.source), loadJsonl(options.target))
  }
  if (mode === 'snapshot') {
    if (!options.source || !options.out) fail('snapshot needs --source and --out')
    return snapshot(loadJsonl(options.source), options.out)
  }
  if (mode === 'verify') {
    if (!options.snapshot) fail('verify needs --snapshot')
    return verifySnapshot(options.snapshot)
  }
  if (mode === 'restore') {
    if (!options.snapshot || !options.target) fail('restore needs --snapshot and --target')
    return restore(options.snapshot, options.target)
  }
  fail('usage: compare | snapshot | verify | restore (see the file header)')
}

try {
  process.exitCode = main()
} catch (error) {
  if (error instanceof RehearsalInputError) {
    console.error(`NATIVE MIGRATION REHEARSAL FAILED (input): ${error.message}`)
    console.error('This is not a pass.')
    process.exit(2)
  }
  throw error
}
