#!/usr/bin/env node
/**
 * The C1 acceptance command: `npm run native:c1:test`.
 *
 * docs/platform/native-cms-c1-acceptance-test-matrix.md §2.1 names this command and
 * the files it runs. A run over zero files would report zero failures, and an empty
 * pass is exactly what the matrix forbids ("every case must exist and run, with zero
 * skipped, zero todo").
 *
 * So the command refuses closed: missing files exit 1 and name what is missing.
 * When the files exist it runs them and then accounts for the matrix itself: every
 * case ID in the matrix tables must appear as a passing test, with no skip, no
 * todo and no case the matrix does not define. A deleted case cannot pass as a
 * shorter suite (implementation sequence Stage 8).
 *
 * Usage: native-c1-test [--root <dir>] [--list]
 * Exit: 0 all planned files exist and the suite passed · 1 C1 not implemented, or
 *       the suite failed · 2 invalid usage
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkMatrixRun } from './native-c1-matrix.mjs'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const MATRIX = 'docs/platform/native-cms-c1-acceptance-test-matrix.md §2.1'
const MATRIX_FILE = 'docs/platform/native-cms-c1-acceptance-test-matrix.md'

/** The matrix's planned test files, in the order it lists them. */
const TESTS = [
  'quicksilver/test/c1/bootstrap.test.ts',
  'quicksilver/test/c1/tenancy.test.ts',
  'quicksilver/test/c1/revisions.test.ts',
  'quicksilver/test/c1/idempotency.test.ts',
  'quicksilver/test/c1/audit-atomicity.test.ts',
  'quicksilver/test/c1/input-bounds.test.ts',
  'quicksilver/test/c1/queries.test.ts',
]

/** Required by every suite; not itself a test file. */
const FIXTURES = ['quicksilver/test/c1/fixtures/two-tenants.ts']

const planned = [...TESTS, ...FIXTURES]

function usage(problem) {
  console.error(`${problem}\nusage: native-c1-test [--root <dir>] [--list]`)
  process.exit(2)
}

let base = repositoryRoot
let list = false
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index]
  if (argument === '--list') {
    list = true
  } else if (argument === '--root') {
    const value = argv[index + 1]
    if (!value) usage('--root needs a directory')
    base = resolve(value)
    index += 1
  } else {
    usage(`unknown argument: ${argument}`)
  }
}

const state = planned.map((file) => ({ file, present: existsSync(join(base, file)) }))

if (list) {
  for (const { file, present } of state) console.log(`${file}  ${present ? 'present' : 'missing'}`)
  process.exit(0)
}

const missing = state.filter((entry) => !entry.present).map((entry) => entry.file)
if (missing.length > 0) {
  console.error(
    [
      `C1 IS NOT IMPLEMENTED: ${missing.length} of ${planned.length} planned C1 files are missing.`,
      ...missing.map((file) => `  missing: ${file}`),
      '',
      'C1 cannot exit: the acceptance matrix defines 50 cases and every one needs a runner.',
      `See ${MATRIX}. This is not a pass.`,
    ].join('\n'),
  )
  process.exit(1)
}

// A gate started from inside another test process inherits NODE_TEST_CONTEXT,
// which makes the inner `node --test` report through that context instead of
// this process's output, so the run would look empty.
const env = { ...process.env }
delete env.NODE_TEST_CONTEXT
const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--no-warnings', '--test', '--test-concurrency=1', ...TESTS],
  { cwd: base, encoding: 'utf8', env },
)

process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')

const check = checkMatrixRun({
  output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  markdown: readFileSync(join(repositoryRoot, MATRIX_FILE), 'utf8'),
  status: result.status ?? 1,
})

if (check.problems.length > 0) {
  console.error(
    [
      '',
      'C1 MATRIX GATE FAILED: this run is not the 50-case matrix.',
      ...check.problems.map((problem) => `  ${problem}`),
      '',
      `See ${MATRIX}. This is not a pass.`,
    ].join('\n'),
  )
  process.exit(1)
}

console.log(
  `C1 matrix: ${check.covered}/${check.expected} cases ran, ${check.counts.pass} passed, 0 skipped, 0 todo.`,
)
process.exit(0)
