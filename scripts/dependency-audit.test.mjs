import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * The dependency gate used to fail open twice: an empty `npm audit --json`
 * report became "0 advisories", and an unparsable `npm ls` tree became "0
 * production packages", both exiting 0. Neither is an empty result; each is a
 * report the gate could not read, so each must fail the run.
 *
 * The script derives its root from its own location and shells out to `npm`,
 * so each fixture is a copy in a temporary tree with a fake `npm` on PATH.
 * That is also evidence the real script is only reachable through a copied
 * environment — the cost of having no root or command seam.
 *
 * Skipped on Windows: the fake `npm` is a shebang script, and `npm.cmd` is what
 * the spawn would look for there.
 */
const SCRIPT = fileURLToPath(new URL('./dependency-audit.mjs', import.meta.url))
const SKIP = { skip: process.platform === 'win32' }

function fixture(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'qs-dependency-audit-'))
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'docs', 'platform'), { recursive: true })
  mkdirSync(join(dir, 'bin'))
  copyFileSync(SCRIPT, join(dir, 'scripts', 'dependency-audit.mjs'))
  writeFileSync(
    join(dir, 'docs', 'platform', 'dependency-advisories.md'),
    ['# decisions', '', '| Package | Class | Decision |', '|---|---|---|', '| `lodash` | build-time | recorded for the fixture |', ''].join('\n'),
  )

  const cleaner = '{"vulnerabilities":{}}'
  const cleanTree = '{"dependencies":{}}'
  const highLodash = '{"vulnerabilities":{"lodash":{"severity":"high","range":"<4.17.21","isDirect":false,"via":[{"title":"lodash prototype pollution","url":""}]}}}'
  const lodashTree = '{"dependencies":{"lodash":{}}}'
  // ~1.5 MiB: over spawnSync's 1 MiB default, so the gate must size its buffer
  // rather than read a truncated report as unreadable.
  const hugeTree = JSON.stringify({ dependencies: Object.fromEntries(Array.from({ length: 90000 }, (_, i) => [`pkg-${i}`, {}])) })
  const reports = {
    ok: [cleaner, cleanTree],
    'audit-empty': [null, cleanTree],
    'audit-garbage': ['not json', cleanTree],
    'ls-empty': [cleaner, null],
    'ls-garbage': [cleaner, 'not json'],
    blocker: [highLodash, lodashTree],
    'ls-huge': [cleaner, hugeTree],
  }[mode]
  if (!reports) throw new Error(`unknown fixture mode: ${mode}`)
  const [audit, ls] = reports
  if (audit === null) writeFileSync(join(dir, 'audit.empty'), '')
  else writeFileSync(join(dir, 'audit.json'), audit)
  if (ls === null) writeFileSync(join(dir, 'ls.empty'), '')
  else writeFileSync(join(dir, 'ls.json'), ls)

  const npm = join(dir, 'bin', 'npm')
  writeFileSync(
    npm,
    [
      '#!/usr/bin/env node',
      "const { existsSync, readFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      'const kind = process.argv[2] === "audit" ? "audit" : "ls"',
      'const root = process.env.QS_DEPS_ROOT',
      'if (existsSync(join(root, kind + ".empty"))) process.exit(1)',
      'const report = join(root, kind + ".json")',
      'if (!existsSync(report)) process.exit(1)',
      'console.log(readFileSync(report, "utf8"))',
      '',
    ].join('\n'),
  )
  chmodSync(npm, 0o755)
  return { dir, bin: join(dir, 'bin') }
}

function run(fixtureDir) {
  return spawnSync(process.execPath, [join(fixtureDir.dir, 'scripts', 'dependency-audit.mjs')], {
    encoding: 'utf8',
    cwd: fixtureDir.dir,
    env: { ...process.env, PATH: `${fixtureDir.bin}:${process.env.PATH}`, QS_DEPS_ROOT: fixtureDir.dir },
  })
}

test('an empty npm audit report fails instead of reporting zero advisories', SKIP, () => {
  const fixtureDir = fixture('audit-empty')
  try {
    const result = run(fixtureDir)
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 1, `an unreadable audit must not exit 0:\n${output}`)
    assert.match(output, /DEPENDENCY AUDIT FAILED \(P-109\): npm audit --json produced no output/)
    assert.doesNotMatch(result.stdout, /advisories reported by npm audit/, 'no counts may be printed from an unreadable audit')
  } finally {
    rmSync(fixtureDir.dir, { recursive: true, force: true })
  }
})

test('an npm audit report that is not JSON fails instead of reporting zero advisories', SKIP, () => {
  const fixtureDir = fixture('audit-garbage')
  try {
    const result = run(fixtureDir)
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 1, `an unparsable audit must not exit 0:\n${output}`)
    assert.match(output, /DEPENDENCY AUDIT FAILED \(P-109\): npm audit --json printed output that is not JSON/)
    assert.doesNotMatch(result.stdout, /advisories reported by npm audit/)
  } finally {
    rmSync(fixtureDir.dir, { recursive: true, force: true })
  }
})

test('an empty npm ls report fails instead of classifying nothing as runtime', SKIP, () => {
  const fixtureDir = fixture('ls-empty')
  try {
    const result = run(fixtureDir)
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 1, `an unreadable production tree must not exit 0:\n${output}`)
    assert.match(output, /DEPENDENCY AUDIT FAILED \(P-109\): npm ls .* produced no output, so the production tree of apps\/web is unknown/)
    assert.doesNotMatch(result.stdout, /production dependency packages/, 'no counts may be printed from an unreadable tree')
  } finally {
    rmSync(fixtureDir.dir, { recursive: true, force: true })
  }
})

test('an npm ls report that is not JSON fails instead of classifying nothing as runtime', SKIP, () => {
  const fixtureDir = fixture('ls-garbage')
  try {
    const result = run(fixtureDir)
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 1, `an unparsable production tree must not exit 0:\n${output}`)
    assert.match(output, /DEPENDENCY AUDIT FAILED \(P-109\): npm ls output for apps\/web is not JSON/)
    assert.doesNotMatch(result.stdout, /production dependency packages/)
  } finally {
    rmSync(fixtureDir.dir, { recursive: true, force: true })
  }
})

test('a production tree larger than the default buffer still classifies instead of reading as unreadable', SKIP, () => {
  const fixtureDir = fixture('ls-huge')
  try {
    const reportBytes = statSync(join(fixtureDir.dir, 'ls.json')).size
    assert.ok(reportBytes > 1024 * 1024, `the fixture must exceed the 1 MiB default to prove anything (got ${reportBytes} bytes)`)
    const result = run(fixtureDir)
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 0, `a large readable tree must pass, not fail as unreadable:\n${output}`)
    assert.doesNotMatch(output, /DEPENDENCY AUDIT FAILED/, 'the buffer must not turn a large report into an input error')
    assert.match(result.stdout, /production dependency packages/)
  } finally {
    rmSync(fixtureDir.dir, { recursive: true, force: true })
  }
})

test('a readable clean report still passes, and a real runtime blocker still fails', SKIP, () => {
  const clean = fixture('ok')
  try {
    const result = run(clean)
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 0, `a readable clean report must pass:\n${output}`)
    assert.match(result.stdout, /advisories reported by npm audit : 0/)
    assert.match(result.stdout, /production dependency packages  : 0/)
  } finally {
    rmSync(clean.dir, { recursive: true, force: true })
  }

  const blocker = fixture('blocker')
  try {
    const result = run(blocker)
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 1, `a runtime high advisory must fail:\n${output}`)
    assert.match(output, /HIGH-SEVERITY ADVISORY IN A RUNTIME DEPENDENCY PATH \(P-109\)/)
    assert.match(output, /lodash@<4\.17\.21/)
    assert.doesNotMatch(output, /DEPENDENCY AUDIT FAILED/, 'the fixture must reach classification, not the input guard')
  } finally {
    rmSync(blocker.dir, { recursive: true, force: true })
  }
})
