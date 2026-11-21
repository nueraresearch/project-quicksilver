#!/usr/bin/env node
/**
 * The local gate: the checks `ci.yml` runs, in one command, on the runtimes it
 * pins.
 *
 * GitHub Actions cannot currently start jobs, so a local green is the only
 * green this repo can get. That is worth something only if it runs the same
 * checks on the same runtime, so this gate refuses to start on a different Node
 * major instead of reporting a pass CI would not reproduce - the C1 matrix gate
 * already differed between Node 22 and Node 26 once.
 *
 * It also refuses to skip a toolchain quietly: a skipped leg is named in the
 * summary and the outcome is reported as incomplete, never as a pass.
 *
 *   npm run gate:local                  # install, then every check
 *   npm run gate:local -- --no-install  # node_modules is already current
 *   npm run gate:local -- --skip-go     # reported as skipped, not as passed
 */
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// Pinned in .github/workflows/ci.yml. Record them here rather than reading the
// workflow: this gate is the thing that has to fail when they drift apart.
const CI = { nodeMajor: 22, goSeries: 'go1.22', python: '3.12' }

// Same lesson as the dependency gate: a chatty check under a default 1 MiB
// buffer fails as unreadable rather than as itself.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const skipGo = flag('--skip-go')
const skipPython = flag('--skip-python')
const skipInstall = flag('--no-install')

if (flag('--help') || flag('-h')) {
  console.log('usage: npm run gate:local [-- --no-install] [-- --skip-go] [-- --skip-python]')
  process.exit(0)
}

const goDir = join(repoRoot, 'packages', 'sdk-go')

const steps = [
  ...(skipInstall ? [] : [{ id: 'install', argv: ['npm', 'ci'] }]),
  { id: 'verify', argv: ['npm', 'run', 'verify'] },
  { id: 'web-build', argv: ['npm', 'run', 'build', '--workspace=@quicksilver/web'] },
  { id: 'clean-install', argv: ['npm', 'run', 'check:clean-install'] },
  { id: 'dependency-audit', argv: ['npm', 'run', 'audit:deps'] },
  { id: 'parity', argv: ['npm', 'run', 'parity:test'] },
  { id: 'native-c1', argv: ['npm', 'run', 'native:c1:test'] },
  { id: 'native-c2', argv: ['npm', 'run', 'native:c2:test'] },
  ...(skipGo
    ? []
    : [
        { id: 'go-vet', argv: ['go', 'vet', './...'], cwd: goDir },
        { id: 'go-test', argv: ['go', 'test', '-timeout=2m', './...'], cwd: goDir },
        { id: 'go-build', argv: ['go', 'build', './...'], cwd: goDir },
      ]),
  ...(skipPython
    ? []
    : [{ id: 'python-sdk', argv: ['python3', '-m', 'unittest', 'discover', '-s', 'packages/sdk-python/tests'] }]),
]

function capture(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES })
  return {
    status: result.error ? 1 : (result.status ?? 1),
    text: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    error: result.error,
  }
}

// Refuse to start rather than produce a green about some other runtime.
const problems = []
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor !== CI.nodeMajor) {
  problems.push(`node ${process.versions.node} - CI pins ${CI.nodeMajor}.x`)
}
if (!skipGo) {
  const go = capture('go', ['version'])
  if (go.error) problems.push('go is not installed - CI pins 1.22.x')
  else if (!go.text.includes(CI.goSeries + '.')) problems.push(`${go.text.trim() || 'go version not reported'} - CI pins ${CI.goSeries}.x`)
}
if (!skipPython) {
  const python = capture('python3', ['--version'])
  if (python.error) problems.push('python3 is not installed - CI pins 3.12')
  else if (!python.text.includes(CI.python + '.')) problems.push(`${python.text.trim() || 'python version not reported'} - CI pins ${CI.python}`)
}

const tree = capture('git', ['rev-parse', '--short', 'HEAD']).text.trim() || 'unknown'
console.log(`local gate: tree ${tree}`)
console.log(`runtime   : node ${process.versions.node} npm ${capture('npm', ['--version']).text.trim()} ${skipGo ? '(go skipped)' : capture('go', ['version']).text.trim()}`)
console.log(`checks    : ${steps.map((step) => step.id).join(', ')}`)

if (problems.length > 0) {
  console.log('\nGATE NOT STARTED - a check would run on a runtime CI does not use:')
  for (const problem of problems) console.log(`  - ${problem}`)
  console.log('\nInstall the pinned runtime, or drop the leg you cannot run; a green here is only evidence about CI\'s runtimes.')
  process.exit(1)
}

const results = []
for (const step of steps) {
  process.stdout.write(`\n>>> ${step.id}\n`)
  const started = Date.now()
  const result = spawnSync(step.argv[0], step.argv.slice(1), {
    cwd: step.cwd ?? repoRoot,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
  })
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const status = result.error ? 1 : (result.status ?? 1)
  const lines = text.trimEnd().split('\n')
  for (const line of lines.slice(-12)) console.log(line)
  if (result.error) console.log(`spawn error: ${result.error.message}`)
  results.push({ id: step.id, status, ms: Date.now() - started })
}

const skipped = [...(skipGo ? ['go'] : []), ...(skipPython ? ['python'] : [])]
const failed = results.filter((result) => result.status !== 0)

console.log('\n=== local gate summary ===')
for (const result of results) {
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'}  ${result.id.padEnd(18)} ${(result.ms / 1000).toFixed(1)}s`)
}
if (skipped.length > 0) console.log(`SKIP  ${skipped.join(', ')} (asked for explicitly; not evidence about CI)`)

if (failed.length > 0) {
  console.log(`\nGATE FAILED: ${failed.map((result) => result.id).join(', ')}`)
  process.exit(1)
}
console.log(skipped.length > 0 ? '\nGATE PASSED (incomplete) - legs were skipped' : '\nGATE PASSED')
console.log(`Not covered by any of this: the windows-latest verify leg, the Vercel preview build, and review.`)
