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
 * Usage: native-capability-totals [--root <dir>] [--docs <file> ...] [--matrix <file>]
 *   --root  scan this tree instead of the repository (its docs/ and quicksilver/README.md)
 * Exit: 0 every quoted total matches · 1 a quote disagrees or nothing was quoted
 *       · 2 invalid input or an unreadable matrix/doc
 */
import { existsSync, readFileSync } from 'node:fs'
import { createReport, labelWithin, listDocs, loadMatrix, parseTargets } from './native-capability-docs.mjs'

/** `**23 core capabilities:** 1 native, 6 partial, 16 absent.` */
const QUOTED_TOTALS =
  /(?:\*\*)?(\d+)\s+(core|content)\s+capabilities:\*{0,2}\s*(\d+)\s+native,\s*(\d+)\s+partial,\s*(\d+)\s+absent/gi

const report = createReport(
  'CAPABILITY TOTALS',
  'usage: native-capability-totals [--root <dir>] [--docs <file> ...] [--matrix <file>]',
)
const { root, matrix, docs } = parseTargets(process.argv.slice(2), report)
const scanned = listDocs({ root, docs }, report.failInput)
const expected = loadMatrix(matrix, report.failInput).tally
if (expected.core.total === 0) report.failInput(`${matrix} declares no core capabilities`)

const label = labelWithin(root)
const problems = []
let blocks = 0

for (const file of scanned) {
  if (!existsSync(file)) report.failInput(`cannot read ${file}`)
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
  report.fail(
    `no doc quotes capability totals in ${scanned.length} scanned file(s), so this check would verify nothing. ` +
      'Quote the totals or remove the check.',
  )
}
if (problems.length > 0) {
  report.fail(`CAPABILITY TOTALS FAILED: ${problems.length} quoted total(s) disagree with ${label(matrix)}.`, problems)
}

console.log(
  `capability totals: ${blocks} quoted block(s) in ${scanned.length} doc(s) match ${label(matrix)} ` +
    `(core ${expected.core.native}/${expected.core.partial}/${expected.core.absent} of ${expected.core.total}; ` +
    `content ${expected.content.native}/${expected.content.partial}/${expected.content.absent} of ${expected.content.total}).`,
)
