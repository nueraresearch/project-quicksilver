import { spawnSync } from 'node:child_process'

const commands = [
  ['kernel:test', 'Kernel regression suite'],
  ['agent:test', 'Agent regression suite'],
  ['host:test', 'Host regression suite'],
  ['qcs:test', 'Communications substrate regression suite'],
  ['operator:test', 'Operator regression suite'],
  ['aura:test', 'Aura regression suite'],
  ['seed:test', 'Seed and web security suite'],
  ['sdk:test', 'TypeScript SDK contract suite'],
  ['parity:test', 'Release parity matrix integrity suite'],
  // `quicksilver/` is not an npm workspace, so the workspace type check never
  // saw it; `typecheck` now includes `tsc -p quicksilver`. Gate A has no other
  // CI path, so it runs here rather than in a separate job that could drift.
  ['native:c1:run', 'Native CMS C1 acceptance cases'],
  // The matrix gate refuses until all eight planned C1 files exist. It runs after
  // the discovering runner so a missing file fails as a gate, not as a shorter suite.
  ['native:c1:test', 'Native CMS C1 acceptance matrix gate'],
  // C2 runs the same repositories over the durable adapter, so it covers the
  // persistence layer C1's in-memory fixture cannot: reopen, id continuity and
  // one commit per multi-table write.
  ['native:c2:test', 'Native CMS C2 durable store suite'],
  ['typecheck', 'TypeScript checks'],
]

let totalTests = 0
let totalPassed = 0
let failedStage = null

for (const [script, label] of commands) {
  process.stdout.write(`\n==> ${label} (npm run ${script})\n`)
  const result = spawnSync('npm', ['run', script], {
    encoding: 'utf8',
    // On Windows `npm` is a .cmd shim, which spawnSync cannot exec without a
    // shell; without this the spawn fails with ENOENT and `status` stays null.
    shell: process.platform === 'win32',
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')

  if (result.error) {
    console.error(`\nVERIFY FAILED: ${script} could not be started (${result.error.code ?? result.error.message})`)
    process.exit(1)
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const count = (pattern) => [...output.matchAll(pattern)].reduce((sum, match) => sum + Number(match[1]), 0)
  const stageTests = count(/(?:ℹ|#) tests (\d+)/g)
  const stagePassed = count(/(?:ℹ|#) pass (\d+)/g)
  totalTests += stageTests
  totalPassed += stagePassed

  if (result.status === null) {
    console.error(`\nVERIFY FAILED: ${script} terminated by ${result.signal ?? 'an unknown signal'} before returning a test status`)
    process.exit(1)
  }

  if (result.status !== 0) {
    failedStage = script
    break
  }

  // A suite can exit 0 without running anything: an emptied test file, or one
  // whose tests are all skipped, reports `tests 0` and `pass 0`. Counting that
  // as a pass is the same false pass as a check that skips its own work, so a
  // test stage must report at least one passing test.
  if (script !== 'typecheck' && stagePassed === 0) {
    console.error(
      `\nVERIFY FAILED: ${script} reported ${stageTests} test(s) and ${stagePassed} pass(es), so it verified nothing`,
    )
    process.exit(1)
  }
}

if (failedStage) {
  console.error(`\nVERIFY FAILED: ${failedStage}`)
  process.exit(1)
}

console.log(`\nVERIFY PASSED: ${totalPassed}/${totalTests} tests passed; type checks passed.`)
