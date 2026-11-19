#!/usr/bin/env node
/**
 * The capability matrix is the source of truth for the removal-gate totals, and
 * the native CMS docs quote those totals. A row change that leaves a doc quoting
 * the old counts is a claim the gate does not make, and nothing fails to say so:
 * this compares every quoted total with the matrix and refuses on any difference.
 *
 * Only the documented sentence shape is read, because a bare pair of numbers is
 * not a totals claim:
 *
 *   - **23 core capabilities:** 1 native, 6 partial, 16 absent.
 *   - **14 content capabilities:** 0 native, 5 partial, 9 absent.
 *
 * A doc set that quotes nothing fails rather than passing over nothing: an empty
 * scan would report agreement with a matrix it never read.
 *
 * Usage: native-capability-totals [--docs <file> ...] [--matrix <file>]
 * Exit: 0 every quoted total matches · 1 a quote disagrees or nothing was quoted
 *       · 2 invalid input or an unreadable matrix/doc
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MATRIX = join(root, 'docs/platform/native-capabilities.json')
const EXTRA_DOCS = ['docs/platform/native-local.md', 'docs/CURRENT-STATUS.md', 'quicksilver/README.md']

/** `**23 core capabilities:** 1 native, 6 partial, 16 absent.` */
const QUOTED_TOTALS =
  /(?:\*\*)?(\d+)\s+(core|content)\s+capabilities:\*{0,2}\s*(\d+)\s+native,\s*(\d+)\s+partial,\s*(\d+)\s+absent/gi

function failInput(message) {
  console.error(`CAPABILITY TOTALS FAILED (input): ${message}`)
  console.error('This is not a pass.')
  process.exit(2)
}

function fail(message, details = []) {
  console.error([message, ...details.map((detail) => `  ${detail}`), '', 'This is not a pass.'].join('\n'))
  process.exit(1)
}

function usage(problem) {
  failInput(`${problem}\nusage: native-capability-totals [--docs <file> ...] [--matrix <file>]`)
}

function defaultDocs() {
  const platform = join(root, 'docs/platform')
  const nativeCms = readdirSync(platform)
    .filter((name) => /^native-cms-.*\.md$/.test(name))
    .sort()
    .map((name) => join(platform, name))
  return [...nativeCms, ...EXTRA_DOCS.map((path) => join(root, path))]
}

function loadMatrix(file) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    failInput(`cannot read ${file} (${error.code ?? 'unreadable'})`)
  }
  let doc
  try {
    doc = JSON.parse(raw)
  } catch (error) {
    failInput(`${file} is not valid JSON: ${error.message}`)
  }
  const rows = Array.isArray(doc?.capabilities) ? doc.capabilities : []
  if (rows.length === 0) failInput(`${file} declares no capabilities`)
  const statuses = new Set(['native', 'partial', 'absent'])
  for (const [index, row] of rows.entries()) {
    if (!statuses.has(row?.native)) {
      failInput(`${file} row ${index} has status ${JSON.stringify(row?.native)}, not one of native, partial or absent`)
    }
  }

  const tally = (set) => ({
    total: set.length,
    native: set.filter((row) => row.native === 'native').length,
    partial: set.filter((row) => row.native === 'partial').length,
    absent: set.filter((row) => row.native === 'absent').length,
  })
  return {
    core: tally(rows.filter((row) => row.core === true)),
    content: tally(rows.filter((row) => typeof row?.id === 'string' && row.id.startsWith('content.'))),
  }
}

let matrix = DEFAULT_MATRIX
let docs = []
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index]
  if (argument === '--matrix' || argument === '--docs') {
    const value = argv[index + 1]
    if (!value) usage(`${argument} needs a file`)
    if (argument === '--matrix') matrix = resolve(value)
    else docs.push(resolve(value))
    index += 1
  } else {
    usage(`unknown argument: ${argument}`)
  }
}
if (docs.length === 0) docs = defaultDocs()

const expected = loadMatrix(matrix)
if (expected.core.total === 0) failInput(`${matrix} declares no core capabilities`)

const label = (file) => (relative(root, file).startsWith('..') ? file : relative(root, file))
const problems = []
let blocks = 0

for (const file of docs) {
  if (!existsSync(file)) failInput(`cannot read ${file}`)
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const match of line.matchAll(QUOTED_TOTALS)) {
      const [, total, scope, native, partial, absent] = match
      const wanted = expected[scope.toLowerCase()]
      const quoted = { total: Number(total), native: Number(native), partial: Number(partial), absent: Number(absent) }
      blocks += 1
      if (
        quoted.total !== wanted.total ||
        quoted.native !== wanted.native ||
        quoted.partial !== wanted.partial ||
        quoted.absent !== wanted.absent
      ) {
        problems.push(
          `${label(file)}:${index + 1} ${scope.toLowerCase()}: quoted ` +
            `${quoted.native} native, ${quoted.partial} partial, ${quoted.absent} absent of ${quoted.total}; ` +
            `the matrix has ${wanted.native} native, ${wanted.partial} partial, ${wanted.absent} absent of ${wanted.total}`,
        )
      }
    }
  })
}

if (blocks === 0) {
  fail(
    `no doc quotes capability totals in ${docs.length} scanned file(s), so this check would verify nothing. ` +
      'Quote the totals or remove the check.',
  )
}
if (problems.length > 0) {
  fail(
    `CAPABILITY TOTALS FAILED: ${problems.length} quoted total(s) disagree with ${label(matrix)}.`,
    problems,
  )
}

console.log(
  `capability totals: ${blocks} quoted block(s) in ${docs.length} doc(s) match ${label(matrix)} ` +
    `(core ${expected.core.native}/${expected.core.partial}/${expected.core.absent} of ${expected.core.total}; ` +
    `content ${expected.content.native}/${expected.content.partial}/${expected.content.absent} of ${expected.content.total}).`,
)
