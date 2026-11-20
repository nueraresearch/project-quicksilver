import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

// The evidence generator names the commit it tested, so two refusals stand
// between a report and a claim it did not earn: a `native:c1:test` command that
// differs from HEAD's, and committed artifacts that name a commit whose matrix
// inputs differ from HEAD's. Both are decided before the matrix runs, so each
// test builds a throwaway repository instead of paying for a suite.

const SCRIPTS = ['native-c1-evidence.mjs', 'native-c1-matrix.mjs', 'native-c1-mutations.mjs']
const ARTIFACTS = ['c1-acceptance-report.md', 'c1-query-contract-report.md']
const COMMAND = 'node scripts/native-c1-test.mjs'

const temp = mkdtempSync(path.join(tmpdir(), 'native-c1-evidence-'))
after(() => rmSync(temp, { recursive: true, force: true }))

const env = { ...process.env }
delete env.NODE_TEST_CONTEXT

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`)
  return result.stdout.trim()
}

function commit(root, message) {
  git(root, 'add', '--all')
  git(
    root,
    '-c',
    'user.name=evidence-test',
    '-c',
    'user.email=evidence-test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '--no-verify',
    '-m',
    message,
  )
  return git(root, 'rev-parse', 'HEAD')
}

function repository(name) {
  const root = path.join(temp, name)
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  for (const file of SCRIPTS) copyFileSync(path.resolve('scripts', file), path.join(root, 'scripts', file))
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ scripts: { 'native:c1:test': COMMAND } }, null, 2)}\n`,
  )
  // Neither refusal reaches the gate, so the matrix file only has to exist as a
  // path the cleanliness check can look at.
  mkdirSync(path.join(root, 'docs/platform'), { recursive: true })
  writeFileSync(path.join(root, 'docs/platform/native-cms-c1-acceptance-test-matrix.md'), '# fixture matrix\n')
  git(root, 'init', '-q')
  return root
}

const evidence = (root, ...args) =>
  spawnSync(process.execPath, [path.join(root, 'scripts/native-c1-evidence.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  })

test('refuses a working copy whose native:c1:test script differs from HEAD, before running it', () => {
  const root = repository('script-drift')
  commit(root, 'matrix inputs')

  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ scripts: { 'native:c1:test': 'node scripts/other-gate.mjs' } }, null, 2)}\n`,
  )

  const result = evidence(root)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /the working copy's "native:c1:test" script differs from the committed one/)
  // The refusal comes before the gate, so it cannot be hiding a run that started.
  assert.doesNotMatch(result.stdout, /C1 evidence: wrote/)
})

test('refuses --check when the artifacts name a commit whose matrix inputs differ from HEAD', () => {
  const root = repository('commit-drift')
  const tested = commit(root, 'matrix inputs')

  // A later code change moves the inputs out from under the artifacts.
  writeFileSync(path.join(root, 'scripts/native-c1-mutations.mjs'), '// changed after the report\n', { flag: 'a' })
  commit(root, 'change a matrix input')

  const directory = path.join(root, 'docs/platform/native-cms-c1-evidence')
  mkdirSync(directory, { recursive: true })
  for (const name of ARTIFACTS) {
    writeFileSync(path.join(directory, name), `# fixture\n\n- **Commit under test:** \`${tested}\`\n`)
  }
  const head = commit(root, 'artifacts naming an earlier run')

  const result = evidence(root, '--check')
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, new RegExp(`the artifacts name ${tested}, but the matrix inputs differ at ${head}`))
  assert.doesNotMatch(result.stdout, /match a fresh green run/)
})
