#!/usr/bin/env node
/**
 * Guard-removal provocation for the C1 matrix (implementation sequence Stage 8).
 *
 * A passing suite proves the cases run; it does not prove they would notice a
 * missing guard. For each mutation in `native-c1-mutations.mjs` this copies the
 * `quicksilver/` tree to a temporary directory, removes one guard, and requires
 * the named positive control to fail. The unmutated copy must pass first, and a
 * mutation that still passes is reported as a failure of the provocation.
 *
 * Nothing in the worktree is modified. Usage: native-c1-provoke [--json]
 * Exit 0 only when the baseline passes and every mutation is caught.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MUTATIONS } from './native-c1-mutations.mjs'
import { runCaseResults } from './native-c1-matrix.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const json = process.argv.includes('--json')
for (const argument of process.argv.slice(2)) {
  if (argument !== '--json') {
    console.error(`unknown argument: ${argument}\nusage: native-c1-provoke [--json]`)
    process.exit(2)
  }
}

const env = { ...process.env }
delete env.NODE_TEST_CONTEXT

function runTests(target) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--test', '--test-concurrency=1', target],
    { cwd: temp, encoding: 'utf8', env },
  )
}

function failingCases(result) {
  return [...runCaseResults(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)]
    .filter(([, state]) => state !== 'pass')
    .map(([id]) => id)
}

const temp = mkdtempSync(join(tmpdir(), 'native-c1-provoke-'))
const results = []
let baselineOk = false

try {
  cpSync(join(root, 'quicksilver'), join(temp, 'quicksilver'), { recursive: true })

  const baseline = runTests('quicksilver/test/c1')
  baselineOk = baseline.status === 0
  if (!baselineOk) {
    console.error(
      `C1 PROVOCATION FAILED: the unmutated suite does not pass, so no guard removal can be interpreted.\n${baseline.stdout ?? ''}${baseline.stderr ?? ''}`,
    )
  }

  for (const mutation of MUTATIONS) {
    const path = join(temp, mutation.file)
    const original = readFileSync(path, 'utf8')
    const occurrences = original.split(mutation.from).length - 1
    if (occurrences !== 1) {
      results.push({
        ...mutation,
        caught: false,
        failingCases: [],
        problem: `the guard text occurs ${occurrences} times in ${mutation.file}; update the mutation`,
      })
      continue
    }

    let result
    try {
      writeFileSync(path, original.replace(mutation.from, mutation.to))
      result = runTests(mutation.gate)
    } finally {
      writeFileSync(path, original)
    }

    const failed = failingCases(result)
    const caught = result.status !== 0 && failed.includes(mutation.expectCase)
    results.push({ ...mutation, caught, failingCases: failed, problem: caught ? undefined : 'the case still passed without the guard' })
  }
} finally {
  rmSync(temp, { recursive: true, force: true })
}

const ok = baselineOk && results.every((entry) => entry.caught)

if (json) {
  console.log(JSON.stringify({ ok, baselineOk, mutations: results }, null, 2))
} else {
  console.log(`C1 provocation: baseline ${baselineOk ? 'passes' : 'FAILED'}; ${results.filter((entry) => entry.caught).length}/${results.length} guard removals caught`)
  for (const entry of results) {
    const detail = entry.caught ? `caught by ${entry.expectCase}` : `NOT CAUGHT: ${entry.problem}`
    console.log(`  ${entry.caught ? '✔' : '✖'} ${entry.id} (${entry.guard}): ${detail}`)
  }
}

if (!ok) {
  console.error('C1 PROVOCATION FAILED: a removed guard was not noticed by its positive control.')
  process.exit(1)
}
