#!/usr/bin/env node
/**
 * Lockfile drift check.
 *
 * `npm ci` refuses when package-lock.json disagrees with a manifest, but only
 * when someone runs it. This compares them directly, offline: for the root
 * manifest and every workspace the `workspaces` globs match, each dependency
 * field must appear in the lock's entry for that path with the same spec, and
 * the lock must not carry a dependency the manifest does not declare.
 *
 * It fails closed. A missing or unparsable lockfile, a lockfile without a
 * `packages` map, or zero dependency specs to compare is exit 2 — "nothing was
 * compared" is not "nothing is wrong". Exit 1 means drift; 0 is the only pass.
 *
 *   node scripts/lockfile-check.mjs [--root <dir>]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

class InputError extends Error {}

function readJson(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new InputError(`cannot read ${path}: ${error.code ?? 'unreadable'}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new InputError(`cannot parse ${path}: ${String(error.message).split('\n')[0]}`)
  }
}

/** The directories the `workspaces` globs match. Only a trailing `*` is supported. */
function workspaceDirectories(base, manifest) {
  const declared = manifest.workspaces ?? []
  const patterns = Array.isArray(declared) ? declared : (declared.packages ?? [])
  const directories = []
  for (const pattern of patterns) {
    const star = pattern.indexOf('*')
    if (star === -1) {
      directories.push(pattern)
      continue
    }
    if (star !== pattern.length - 1) throw new InputError(`unsupported workspaces pattern "${pattern}": only a trailing * is understood`)
    const parent = pattern.slice(0, -1).replace(/\/$/, '')
    let entries
    try {
      entries = readdirSync(join(base, parent), { withFileTypes: true })
    } catch (error) {
      throw new InputError(`cannot read workspaces directory ${parent}: ${error.code ?? 'unreadable'}`)
    }
    for (const entry of entries) if (entry.isDirectory()) directories.push(parent ? `${parent}/${entry.name}` : entry.name)
  }
  return directories
}

/** Every dependency field of `manifest` compared with `entry`, the lock's copy. */
function compare(manifestPath, label, manifest, entry, drift) {
  let compared = 0
  for (const field of FIELDS) {
    const wanted = manifest[field] ?? {}
    const locked = entry[field] ?? {}
    for (const [name, spec] of Object.entries(wanted)) {
      compared += 1
      if (locked[name] !== spec) {
        drift.push(`${label}: ${field} "${name}" is "${spec}" in the manifest but ${name in locked ? `"${locked[name]}"` : 'absent'} in the lockfile`)
      }
    }
    for (const name of Object.keys(locked)) {
      if (!(name in wanted)) drift.push(`${label}: ${field} "${name}" is in the lockfile but not in the manifest`)
    }
  }
  return compared
}

function checkLockfile(root) {
  const base = resolve(root)
  const manifestPath = join(base, 'package.json')
  const manifest = readJson(manifestPath)
  const lock = readJson(join(base, 'package-lock.json'))
  const locked = lock.packages
  if (lock.lockfileVersion < 2 || !locked || typeof locked !== 'object') {
    throw new InputError('package-lock.json has no packages map; lockfileVersion 2 or 3 is required')
  }

  const drift = []
  let compared = compare(manifestPath, 'package.json', manifest, locked[''] ?? {}, drift)
  const workspaces = workspaceDirectories(base, manifest)
  for (const directory of workspaces) {
    const path = join(base, directory, 'package.json')
    if (!existsSync(path)) continue
    const entry = locked[directory]
    if (!entry) {
      drift.push(`${directory}: the workspace has no entry in package-lock.json`)
      continue
    }
    compared += compare(path, `${directory}/package.json`, readJson(path), entry, drift)
  }

  // An empty tree is a refusal, but a workspace missing from the lock is drift
  // and must report as such rather than as "nothing was compared".
  if (compared === 0 && drift.length === 0) throw new InputError(`no dependency specs to compare under ${base}; nothing was verified`)
  return { compared, workspaces: workspaces.length, drift }
}

function main() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--root')
  const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : args[at + 1]
  if (!root) throw new InputError('--root needs a directory')

  const result = checkLockfile(root)
  console.log(`lockfile: ${result.workspaces} workspace(s), ${result.compared} dependency spec(s) compared, ${result.drift.length} drift(s)`)
  if (result.drift.length === 0) {
    console.log('LOCKFILE CHECK PASSED')
    return 0
  }
  for (const line of result.drift) console.log(`  ${line}`)
  console.log('LOCKFILE CHECK FAILED: package-lock.json disagrees with the manifests. This is not a pass.')
  return 1
}

try {
  process.exitCode = main()
} catch (error) {
  if (!(error instanceof InputError)) throw error
  console.error(`LOCKFILE CHECK FAILED (input): ${error.message}`)
  console.error('Nothing was verified. This is not a pass.')
  process.exitCode = 2
}
