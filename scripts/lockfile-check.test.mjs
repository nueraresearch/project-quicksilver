import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * `npm ci` catches lockfile drift, but only if it is run and only on the
 * machine that runs it. These pin the comparison itself: agreement passes,
 * a spec that moved or a dependency that vanished fails and is named, a lock
 * with nothing to compare is neither a pass nor a failure, and this
 * repository's own lockfile agrees with its manifests.
 */
const SCRIPT = fileURLToPath(new URL('./lockfile-check.mjs', import.meta.url))

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'qs-lockfile-'))
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  return dir
}

const run = (dir) => spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' })

const root = { name: 'root', workspaces: ['packages/*'] }
const member = { name: 'a', dependencies: { x: '^1.0.0' } }
const lockFor = (memberDeps) => ({
  name: 'root',
  lockfileVersion: 3,
  packages: { '': { name: 'root', workspaces: ['packages/*'] }, 'packages/a': { name: 'a', dependencies: memberDeps } },
})

test('a lockfile that agrees with every manifest passes', () => {
  const dir = fixture({
    'package.json': root,
    'packages/a/package.json': member,
    'package-lock.json': lockFor({ x: '^1.0.0' }),
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
    assert.match(result.stdout, /1 workspace\(s\), 1 dependency spec\(s\) compared, 0 drift\(s\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a spec that moved fails and names the manifest and field', () => {
  const dir = fixture({
    'package.json': root,
    'packages/a/package.json': member,
    'package-lock.json': lockFor({ x: '^0.9.0' }),
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
    assert.match(result.stdout, /packages\/a\/package\.json: dependencies "x" is "\^1\.0\.0" in the manifest but "\^0\.9\.0" in the lockfile/)
    assert.match(result.stdout, /LOCKFILE CHECK FAILED/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a dependency only the lockfile carries fails', () => {
  const dir = fixture({
    'package.json': root,
    'packages/a/package.json': member,
    'package-lock.json': lockFor({ x: '^1.0.0', ghost: '^2.0.0' }),
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
    assert.match(result.stdout, /dependencies "ghost" is in the lockfile but not in the manifest/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a workspace with no lockfile entry fails', () => {
  const dir = fixture({
    'package.json': root,
    'packages/a/package.json': member,
    'package-lock.json': { lockfileVersion: 3, packages: { '': { name: 'root' } } },
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
    assert.match(result.stdout, /packages\/a: the workspace has no entry in package-lock\.json/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing lockfile exits 2 rather than passing', () => {
  const dir = fixture({ 'package.json': root, 'packages/a/package.json': member })
  try {
    const result = run(dir)
    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`)
    assert.match(result.stderr, /cannot read .*package-lock\.json/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a lockfile with nothing to compare exits 2', () => {
  const dir = fixture({
    'package.json': { name: 'root', workspaces: ['packages/*'] },
    'packages/.keep': '',
    'package-lock.json': { lockfileVersion: 3, packages: { '': { name: 'root' } } },
  })
  try {
    const result = run(dir)
    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`)
    assert.match(result.stderr, /no dependency specs to compare/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The point of wiring this into parity:test: it must actually read this
// repository's lockfile, not only fixtures.
test("this repository's lockfile agrees with its manifests", () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
  assert.equal(result.status, 0, `the check failed against this repository:\n${result.stdout}${result.stderr}`)
})
