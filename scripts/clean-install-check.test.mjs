import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * The clean-install check previously printed PASSED after deciding not to start
 * the console, because a local `.env` made a "no configuration" run meaningless.
 * A skipped check is neither a pass nor a failure: it exits 2 and says what was
 * not verified, which is the outcome these tests pin.
 *
 * The script derives its root from its own location and shells out to `npm`, so
 * the fixture is a copy in a temporary tree with a fake `npm` on PATH. That is
 * also evidence the real script is only reachable through a copied environment —
 * the cost of having no root or command seam.
 *
 * Skipped on Windows: the fake `npm` is a shebang script, and `npm.cmd` is what
 * the check would look for there.
 */
const SCRIPT = fileURLToPath(new URL('./clean-install-check.mjs', import.meta.url))

function fixture({ withEnv, withDev = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qs-clean-install-'))
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'apps', 'web'), { recursive: true })
  mkdirSync(join(dir, 'bin'))
  copyFileSync(SCRIPT, join(dir, 'scripts', 'clean-install-check.mjs'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', workspaces: ['apps/*'], scripts: withDev ? { dev: 'npm run dev --workspace=@quicksilver/web' } : {} }),
  )
  writeFileSync(
    join(dir, 'apps', 'web', 'package.json'),
    JSON.stringify({ name: '@quicksilver/web', scripts: { dev: 'next dev' } }),
  )
  if (withEnv) writeFileSync(join(dir, '.env'), 'SANITY_STUDIO_PROJECT_ID=example\n')

  const npm = join(dir, 'bin', 'npm')
  writeFileSync(
    npm,
    [
      '#!/usr/bin/env node',
      "const args = process.argv.slice(2).join(' ')",
      "if (args.includes('--workspace=@quicksilver/studio')) {",
      "  console.log('Zero-config console: run npm run dev at the repository root.')",
      '  process.exit(1)',
      '}',
      'process.exit(1)',
      '',
    ].join('\n'),
  )
  chmodSync(npm, 0o755)
  return { dir, bin: join(dir, 'bin') }
}

function run(fixtureDir) {
  return spawnSync(process.execPath, [join(fixtureDir.dir, 'scripts', 'clean-install-check.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fixtureDir.bin}:${process.env.PATH}` },
  })
}

test('a skipped live check exits 2 and never claims a pass', { skip: process.platform === 'win32' }, () => {
  const fixtureDir = fixture({ withEnv: true })
  try {
    const result = run(fixtureDir)
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 2, `a skipped check must not exit 0:\n${output}`)
    assert.match(output, /CLEAN INSTALL CHECK SKIPPED/, 'the outcome must name itself as skipped')
    assert.match(output, /not a pass/, 'the outcome must say the promise is unverified')
    assert.doesNotMatch(output, /CLEAN INSTALL CHECK PASSED/, 'a skipped check must never print PASSED')
  } finally {
    rmSync(fixtureDir.dir, { recursive: true, force: true })
  }
})

test('a real failure still exits 1, ahead of the skip outcome', { skip: process.platform === 'win32' }, () => {
  const fixtureDir = fixture({ withEnv: false, withDev: false })
  try {
    const result = run(fixtureDir)
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 1, `a broken dev graph must fail, not skip:\n${output}`)
    assert.match(output, /CLEAN INSTALL CHECK FAILED/, 'a failure must name itself as failed')
    assert.doesNotMatch(output, /CLEAN INSTALL CHECK SKIPPED/, 'a failure must not be reported as a skip')
  } finally {
    rmSync(fixtureDir.dir, { recursive: true, force: true })
  }
})
