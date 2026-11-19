/**
 * Matrix accounting for the C1 gate (implementation sequence Stage 8).
 *
 * The acceptance matrix is the source of truth for how many cases exist. A run
 * that omits a case, or reports one skipped or todo, is not the matrix even when
 * everything it executed passed. So the gate compares the case IDs it finds in
 * test names against the IDs in the matrix tables and refuses on any difference.
 */

/** A table row that defines a case, e.g. `| **C1-B04** | ... |`. */
const CASE_ROW = /^\|\s*\*\*(C1-[A-G]\d{2}[a-z]?)\*\*\s*\|/gm

/** A reported test result line, whatever indentation the reporter uses. */
const CASE_RESULT = /^[ \t]*[✔✖﹣↓]\s+(C1-[A-G]\d{2}[a-z]?)\b/gm

export function matrixCaseIds(markdown) {
  return new Set([...markdown.matchAll(CASE_ROW)].map((match) => match[1]))
}

export function runCaseResults(output) {
  const results = new Map()
  for (const match of output.matchAll(CASE_RESULT)) {
    results.set(match[1], match[0].includes('✔') ? 'pass' : 'fail')
  }
  return results
}

function summary(output) {
  // A stage can print more than one summary line; the run's own total is last.
  const read = (label) => {
    const values = [...output.matchAll(new RegExp(`(?:ℹ|#) ${label} (\\d+)`, 'g'))]
    return values.length > 0 ? Number(values.at(-1)[1]) : 0
  }
  return { tests: read('tests'), pass: read('pass'), fail: read('fail'), skipped: read('skipped'), todo: read('todo') }
}

/**
 * @returns {{ problems: string[], counts: object, covered: number, expected: number }}
 * `problems` is empty only when every matrix case ran and passed with no skip or todo.
 */
export function checkMatrixRun({ output, markdown, status }) {
  const expected = matrixCaseIds(markdown)
  const results = runCaseResults(output)
  const counts = summary(output)
  const problems = []

  if (expected.size !== 50) problems.push(`the matrix defines ${expected.size} cases, not 50`)

  const missing = [...expected].filter((id) => !results.has(id))
  if (missing.length > 0) problems.push(`no test reported ${missing.length} matrix case(s): ${missing.join(', ')}`)

  const unknown = [...results.keys()].filter((id) => !expected.has(id))
  if (unknown.length > 0) problems.push(`test names carry cases the matrix does not define: ${unknown.join(', ')}`)

  const notPassed = [...results].filter(([, state]) => state !== 'pass').map(([id]) => id)
  if (notPassed.length > 0) problems.push(`cases that did not pass: ${notPassed.join(', ')}`)

  if (counts.skipped > 0) problems.push(`${counts.skipped} test(s) skipped`)
  if (counts.todo > 0) problems.push(`${counts.todo} test(s) todo`)
  if (counts.fail > 0) problems.push(`${counts.fail} test(s) failed`)
  if (status !== 0) problems.push(`the test run exited ${status}`)

  return { problems, counts, covered: results.size, expected: expected.size }
}
