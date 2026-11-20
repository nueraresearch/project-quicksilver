import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * `VERIFY PASSED` is a claim about the regression suites, and a suite that exits
 * 0 without running a passing test makes that claim false. Node's runner reports
 * an emptied or fully skipped file as `tests 0` / `pass 0` with exit code 0, so
 * the exit status alone cannot tell a pass from an unverified stage.
 *
 * The script shells out to `npm run <script>` and has no command seam, so the
 * fixture copies it into a temporary tree with a fake `npm` on PATH.
 *
 * Skipped on Windows: the fake `npm` is a shebang script, and `npm.cmd` is what
 * the spawned command resolves there.
 */
const SCRIPT = fileURLToPath(new URL('./verify.mjs', import.meta.url))

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'qs-verify-'))
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'bin'))
  copyFileSync(SCRIPT, join(dir, 'scripts', 'verify.mjs'))
  const npm = join(dir, 'bin', 'npm')
  writeFileSync(
    npm,
    [
      '#!/usr/bin/env node',
      "const { appendFileSync } = require('node:fs')",
      'const script = process.argv[3]',
      'appendFileSync(process.env.QS_VERIFY_CALLS, `${script}\\n`)',
      "if (script === 'typecheck') process.exit(0)",
      "if (process.env.QS_VERIFY_FIXTURE === 'empty') {",
      "  console.log('ℹ tests 0')",
      "  console.log('ℹ pass 0')",
      '} else {',
      "  console.log('ℹ tests 2')",
      "  console.log('ℹ pass 2')",
      '}',
      'process.exit(0)',
      '',
    ].join('\n'),
  )
  chmodSync(npm, 0o755)
  return { dir, bin: join(dir, 'bin') }
}

function run(fixtureDir, mode) {
  return spawnSync(process.execPath, [join(fixtureDir.dir, 'scripts', 'verify.mjs')], {
    encoding: 'utf8',
    cwd: fixtureDir.dir,
    env: {
      ...process.env,
      PATH: `${fixtureDir.bin}:${process.env.PATH}`,
      QS_VERIFY_FIXTURE: mode,
      QS_VERIFY_CALLS: join(fixtureDir.dir, 'calls.log'),
    },
  })
}

test('a stage that runs no passing test cannot produce VERIFY PASSED', { skip: process.platform === 'win32' }, () => {
  const fixtureDir = fixture()
  try {
    const result = run(fixtureDir, 'empty')
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 1, `an unverified stage must not exit 0:\n${output}`)
    assert.match(output, /VERIFY FAILED: kernel:test reported 0 test\(s\) and 0 pass\(es\), so it verified nothing/)
    assert.doesNotMatch(output, /VERIFY PASSED/, 'a run with no passing test must never claim a pass')
  } finally {
    rmSync(fixtureDir.dir, { recursive: true, force: true })
  }
})

// Prevents: the C1 suite, the eight-file matrix gate or the quicksilver type
// check being dropped from the chain. They have no other CI path, so an absence
// would be silent.
test('the verify chain runs the C1 acceptance suite and type-checks quicksilver', { skip: process.platform === 'win32' }, () => {
  const fixtureDir = fixture()
  try {
    const result = run(fixtureDir, 'ok')
    assert.equal(result.status, 0, result.stderr)
    const invoked = readFileSync(join(fixtureDir.dir, 'calls.log'), 'utf8').trim().split('\n')
    assert.ok(invoked.includes('native:c1:run'), `the chain must run native:c1:run; it ran ${invoked.join(', ')}`)
    assert.ok(invoked.includes('native:c1:test'), `the chain must run native:c1:test; it ran ${invoked.join(', ')}`)

    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    assert.match(pkg.scripts.typecheck, /tsc -p quicksilver/, 'quicksilver is not a workspace, so typecheck must name it')
  } finally {
    rmSync(fixtureDir.dir, { recursive: true, force: true })
  }
})

test('a run whose stages pass keeps the VERIFY PASSED outcome', { skip: process.platform === 'win32' }, () => {
  const fixtureDir = fixture()
  try {
    const result = run(fixtureDir, 'ok')
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 0, `a verified run must pass:\n${output}`)
    assert.match(output, /VERIFY PASSED: 22\/22 tests passed; type checks passed\./)
  } finally {
    rmSync(fixtureDir.dir, { recursive: true, force: true })
  }
})
