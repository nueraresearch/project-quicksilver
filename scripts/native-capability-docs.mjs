/**
 * Shared plumbing for `native-capability-totals.mjs` and
 * `native-capability-enumeration.mjs`.
 *
 * Both checks read the same inputs — markdown claims under `docs/` against the
 * capability matrix in `docs/platform/native-capabilities.json` — so discovery,
 * matrix loading and argument parsing live here once. What stays in each check
 * is its own question, its own refusals and its own wording; this module only
 * supplies the inputs and the shared failure shape.
 *
 * Everything that fails, fails closed: an unreadable or malformed matrix, an
 * unknown status, a missing `docs/` tree or an argument the check does not
 * understand exits 2, and says so.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository root, which is the default `--root` for both checks. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const MATRIX_PATH = 'docs/platform/native-capabilities.json'
const EXTRA_DOCS = ['quicksilver/README.md']
const STATUSES = new Set(['native', 'partial', 'absent'])

/**
 * The exit paths both checks share. `headline` opens the refusal, `usageLine` is
 * appended to every argument problem.
 *
 * Exit 1 is "the docs and the matrix disagree" (or the check would verify
 * nothing); exit 2 is "the inputs are not readable or not valid".
 */
export function createReport(headline, usageLine) {
  const failInput = (message) => {
    console.error(`${headline} FAILED (input): ${message}`)
    console.error('This is not a pass.')
    process.exit(2)
  }
  return {
    failInput,
    fail(message, details = []) {
      console.error([message, ...details.map((detail) => `  ${detail}`), '', 'This is not a pass.'].join('\n'))
      process.exit(1)
    },
    usage(problem) {
      failInput(`${problem}\n${usageLine}`)
    },
  }
}

/** `--root <dir>`, repeatable `--docs <file>` and `--matrix <file>`. */
export function parseTargets(argv, { usage, failInput }) {
  let root = repositoryRoot
  let matrix
  const docs = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const value = argv[index + 1]
    if (argument === '--matrix' || argument === '--docs' || argument === '--root') {
      if (!value) usage(`${argument} needs a ${argument === '--root' ? 'directory' : 'file'}`)
      if (argument === '--matrix') matrix = resolve(value)
      else if (argument === '--root') root = resolve(value)
      else docs.push(resolve(value))
      index += 1
    } else {
      usage(`unknown argument: ${argument}`)
    }
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) failInput(`--root is not a directory: ${root}`)
  return { root, matrix: matrix ?? join(root, MATRIX_PATH), docs }
}

function markdownUnder(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...markdownUnder(full))
    else if (entry.isFile() && /\.md$/i.test(entry.name)) found.push(full)
  }
  return found
}

/**
 * The docs to read: the `--docs` files when given, otherwise every markdown file
 * under `docs/` plus `quicksilver/README.md`. Discovery is by file system, not a
 * hand-kept list, so a doc that starts making a claim later is checked without
 * anyone adding it here.
 */
export function listDocs({ root, docs }, failInput) {
  if (docs.length > 0) return docs
  let scanned
  try {
    scanned = [...markdownUnder(join(root, 'docs')), ...EXTRA_DOCS.map((path) => join(root, path))]
      .filter(existsSync)
      .sort()
  } catch (error) {
    failInput(`cannot read ${join(root, 'docs')} (${error.code ?? 'unreadable'})`)
  }
  if (scanned.length === 0) failInput(`no markdown files found under ${join(root, 'docs')}`)
  return scanned
}

/**
 * The matrix rows, the core rows by id, and the per-scope status tallies the
 * totals check quotes. Every row's status must be one of the three the docs
 * quote; anything else would silently sum to less than the row count.
 */
export function loadMatrix(file, failInput) {
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
  for (const [index, row] of rows.entries()) {
    if (!STATUSES.has(row?.native)) {
      failInput(`${file} row ${index} has status ${JSON.stringify(row?.native)}, not one of native, partial or absent`)
    }
  }

  const tally = (set) => ({
    total: set.length,
    native: set.filter((row) => row.native === 'native').length,
    partial: set.filter((row) => row.native === 'partial').length,
    absent: set.filter((row) => row.native === 'absent').length,
  })
  const coreRows = rows.filter((row) => row.core === true)
  return {
    rows: new Map(rows.map((row) => [row.id, row])),
    core: new Map(coreRows.map((row) => [row.id, row])),
    tally: {
      core: tally(coreRows),
      content: tally(rows.filter((row) => typeof row?.id === 'string' && row.id.startsWith('content.'))),
    },
  }
}

/** `docs/…/file.md` for a file inside the root, the absolute path otherwise. */
export function labelWithin(root) {
  return (file) => (relative(root, file).startsWith('..') ? file : relative(root, file))
}
