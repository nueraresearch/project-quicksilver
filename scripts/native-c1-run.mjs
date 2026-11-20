#!/usr/bin/env node
/**
 * Runs every C1 gate test file that exists, so a gate cannot land unrun.
 *
 * `native:c1:test` is the matrix gate: it refuses until all seven planned files
 * exist. This command is its per-gate counterpart — it discovers what is there
 * and runs it, which is what makes "the file exists" also mean "the file runs".
 *
 * An empty discovery is a failure, not a pass: zero files reporting zero
 * failures is exactly the outcome the acceptance matrix forbids.
 *
 * Usage: native-c1-run [<dir>]   (default: quicksilver/test/c1)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const option = args.find((argument) => argument.startsWith('-'))
if (option) {
  console.error(`unknown option ${option}\nusage: native-c1-run [<dir>]`)
  process.exit(2)
}
if (args.length > 1) {
  console.error(`unexpected argument ${args.slice(1).join(', ')}\nusage: native-c1-run [<dir>]`)
  process.exit(2)
}

const directory = resolve(args[0] ?? 'quicksilver/test/c1')
if (!existsSync(directory)) {
  console.error(`C1 GATE FAILED: ${args[0] ?? 'quicksilver/test/c1'} does not exist. This is not a pass.`)
  process.exit(1)
}

function discover(current) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name)
    if (entry.isDirectory()) return discover(path)
    return entry.name.endsWith('.test.ts') ? [path] : []
  })
}

const files = discover(directory).sort()
if (files.length === 0) {
  console.error(`C1 GATE FAILED: no *.test.ts files under ${args[0] ?? 'quicksilver/test/c1'}. This is not a pass.`)
  process.exit(1)
}

console.log(`C1 gate: running ${files.length} file(s)`)
// A runner started from inside another test process inherits NODE_TEST_CONTEXT,
// which makes the inner `node --test` report through that context instead of
// this process's output, so the run would look empty.
const env = { ...process.env }
delete env.NODE_TEST_CONTEXT
const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--no-warnings', '--test', '--test-concurrency=1', ...files],
  { stdio: 'inherit', env },
)

process.exit(result.status ?? 1)
