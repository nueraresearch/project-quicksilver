#!/usr/bin/env node
/**
 * The capability totals check verifies the counts; it cannot see which rows are
 * named. `docs/platform/native-local.md` also enumerates the rows themselves —
 * "X is the only native core row, A, B and C are partial, and D, E and F are
 * absent" — and that sentence drifted once already when a row changed status.
 *
 * This check reads that sentence and requires every `core: true` row to be
 * named, in the group its status puts it in:
 *
 *   - a row no phrase covers fails, so a new core capability cannot be added
 *     without being named;
 *   - a row named under the wrong status fails, so a status change cannot leave
 *     the sentence behind;
 *   - an id the matrix does not define fails, so a removed row cannot linger.
 *
 * The phrase-to-row map below is the only hand-kept part. It is deliberately
 * narrow: each phrase must carry the row (or rows) the sentence names as a
 * group, and adding a row requires naming it here and in the sentence.
 *
 * Usage: native-capability-enumeration [--root <dir>] [--docs <file> ...] [--matrix <file>]
 * Exit: 0 every core row is named in its group · 1 a row is unnamed, misplaced or
 *       undefined, or no sentence was found · 2 invalid input
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MATRIX_PATH = 'docs/platform/native-capabilities.json'
const EXTRA_DOCS = ['quicksilver/README.md']

/** The three clause markers the sentence is documented to carry. */
const ANCHOR = 'A blocked gate is the expected state today:'
const NATIVE_MARK = 'is the only native core row,'
const PARTIAL_MARK = 'are partial, and'
const ABSENT_MARK = 'are absent.'

/** How the sentence names each row. One phrase may name a group of rows. */
const NAMED = [
  { phrase: 'local BYO-model planning', ids: ['inference.local-planning'] },
  { phrase: 'the ontology scaffold', ids: ['content.ontology'] },
  { phrase: 'tenant-scoped query contracts', ids: ['content.query.tenant'] },
  { phrase: 'API response contracts', ids: ['content.api-response-contract'] },
  { phrase: 'tenant isolation', ids: ['content.tenant-isolation'] },
  { phrase: 'SMTP submission', ids: ['email.smtp-submission'] },
  { phrase: 'the migration rehearsal harness', ids: ['content.migration-rehearsal'] },
  {
    phrase: 'the remaining Sanity content capabilities',
    ids: [
      'content.decisions',
      'content.agent-catalog',
      'content.workflow-publication',
      'content.chat-inbox',
      'content.studio-admin',
      'content.seed-fixtures',
      'content.context-retrieval',
      'content.backup-restore',
      'content.credential-free-startup',
    ],
  },
  {
    phrase: 'local identity',
    ids: ['identity.oidc-signin', 'identity.local-enrollment', 'identity.session-store'],
  },
  { phrase: 'model provisioning', ids: ['inference.local-install'] },
  { phrase: 'inbound email', ids: ['email.inbound'] },
  { phrase: 'STARTTLS submission', ids: ['email.starttls'] },
  { phrase: 'live native delivery', ids: ['email.live-delivery'] },
]

function failInput(message) {
  console.error(`CAPABILITY ENUMERATION FAILED (input): ${message}`)
  console.error('This is not a pass.')
  process.exit(2)
}

function fail(message, details = []) {
  console.error([message, ...details.map((detail) => `  ${detail}`), '', 'This is not a pass.'].join('\n'))
  process.exit(1)
}

function usage(problem) {
  failInput(`${problem}\nusage: native-capability-enumeration [--root <dir>] [--docs <file> ...] [--matrix <file>]`)
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

function defaultDocs(root) {
  return [...markdownUnder(join(root, 'docs')), ...EXTRA_DOCS.map((path) => join(root, path))]
    .filter(existsSync)
    .sort()
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
  return new Map(rows.map((row) => [row.id, row]))
}

let root = scriptRoot
let matrix
let docs = []
const argv = process.argv.slice(2)
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
if (!matrix) matrix = join(root, MATRIX_PATH)

const rows = loadMatrix(matrix)
const core = new Map([...rows].filter(([, row]) => row.core === true))
if (core.size === 0) failInput(`${matrix} declares no core capabilities`)

// The map itself must stay complete and unambiguous: a row twice or never is a
// checker bug that would otherwise hide behind a green run.
const nameOf = new Map()
for (const entry of NAMED) {
  for (const id of entry.ids) {
    if (nameOf.has(id)) failInput(`the checker names ${id} under two phrases`)
    nameOf.set(id, entry)
  }
}

let scanned
if (docs.length > 0) {
  scanned = docs
} else {
  try {
    scanned = defaultDocs(root)
  } catch (error) {
    failInput(`cannot read ${join(root, 'docs')} (${error.code ?? 'unreadable'})`)
  }
}
if (scanned.length === 0) failInput(`no markdown files found under ${join(root, 'docs')}`)

const label = (file) => (relative(root, file).startsWith('..') ? file : relative(root, file))
const problems = []
let sentences = 0
let namedRows = 0

for (const file of scanned) {
  if (!existsSync(file)) failInput(`cannot read ${file}`)
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes(ANCHOR)) continue
    let end = index
    let block = lines[index]
    while (!block.includes(ABSENT_MARK) && end + 1 < lines.length && end - index < 20) {
      end += 1
      block = `${block} ${lines[end]}`
    }
    const flat = block.replace(/\s+/g, ' ')
    const nativeEnd = flat.indexOf(NATIVE_MARK)
    const partialStart = nativeEnd === -1 ? -1 : nativeEnd + NATIVE_MARK.length
    const partialEnd = partialStart === -1 ? -1 : flat.indexOf(PARTIAL_MARK, partialStart)
    const absentStart = partialEnd === -1 ? -1 : partialEnd + PARTIAL_MARK.length
    const absentEnd = absentStart === -1 ? -1 : flat.indexOf(ABSENT_MARK, absentStart)
    const at = `${label(file)}:${index + 1}`
    if (nativeEnd === -1 || partialEnd === -1 || absentEnd === -1) {
      problems.push(`${at} has the totals anchor but not the documented sentence shape; regenerate it from the template.`)
      continue
    }
    sentences += 1
    const segments = {
      native: flat.slice(flat.indexOf(ANCHOR) + ANCHOR.length, nativeEnd),
      partial: flat.slice(partialStart, partialEnd),
      absent: flat.slice(absentStart, absentEnd),
    }

    for (const [id, row] of core) {
      const entry = nameOf.get(id)
      if (!entry) {
        problems.push(`${at} does not name ${id}; add a phrase for every core row.`)
        continue
      }
      const holders = Object.entries(segments)
        .filter(([, text]) => text.toLowerCase().includes(entry.phrase.toLowerCase()))
        .map(([status]) => status)
      if (holders.length === 0) {
        problems.push(`${at} does not name ${id} ("${entry.phrase}"); every core row must appear once.`)
      } else if (holders.length > 1) {
        problems.push(`${at} names "${entry.phrase}" in ${holders.join(' and ')}; it must sit in one group.`)
      } else if (holders[0] !== row.native) {
        problems.push(`${id} is ${row.native} in the matrix but the sentence lists "${entry.phrase}" under ${holders[0]}.`)
      } else {
        namedRows += 1
      }
    }

    for (const entry of NAMED) {
      for (const id of entry.ids) {
        if (!rows.has(id)) problems.push(`${at} names ${id}, which ${label(matrix)} does not define.`)
      }
    }
  }
}

if (sentences === 0) {
  fail(
    `no capability enumeration sentence found in ${scanned.length} scanned file(s), so this check would verify nothing. ` +
      `Expected "${ANCHOR} … ${NATIVE_MARK} … ${PARTIAL_MARK} … ${ABSENT_MARK}" in docs/platform/native-local.md.`,
  )
}
if (problems.length > 0) {
  fail(`CAPABILITY ENUMERATION FAILED: the sentence and ${label(matrix)} disagree.`, problems)
}

console.log(
  `capability enumeration: ${sentences} sentence(s) name all ${core.size} core rows in their matrix group ` +
    `(${[...core.values()].filter((row) => row.native === 'native').length} native, ` +
    `${[...core.values()].filter((row) => row.native === 'partial').length} partial, ` +
    `${[...core.values()].filter((row) => row.native === 'absent').length} absent).`,
)
