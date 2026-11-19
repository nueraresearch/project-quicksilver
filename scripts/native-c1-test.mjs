#!/usr/bin/env node
/**
 * The C1 acceptance command: `npm run native:c1:test`.
 *
 * docs/platform/native-cms-c1-acceptance-test-matrix.md §2.1 names this command and
 * the files it runs. C1 is not implemented, so those files do not exist yet. A run
 * over zero files would report zero failures, and an empty pass is exactly what the
 * matrix forbids ("every case must exist and run, with zero skipped, zero todo").
 *
 * So the command is wired now and refuses closed: missing files exit 1 and name what
 * is missing. Once the files exist it runs them with Node's test runner unchanged,
 * so nothing here has to be revisited when C1 starts.
 *
 * Usage: native-c1-test [--root <dir>] [--list]
 * Exit: 0 all planned files exist and the suite passed · 1 C1 not implemented, or
 *       the suite failed · 2 invalid usage
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const MATRIX = 'docs/platform/native-cms-c1-acceptance-test-matrix.md §2.1'

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

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--no-warnings', '--test', '--test-concurrency=1', ...TESTS],
  { cwd: base, stdio: 'inherit' },
)

process.exit(result.status ?? 1)
