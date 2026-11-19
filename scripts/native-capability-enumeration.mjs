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
import { existsSync, readFileSync } from 'node:fs'
import { createReport, labelWithin, listDocs, loadMatrix, parseTargets } from './native-capability-docs.mjs'

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

const report = createReport(
  'CAPABILITY ENUMERATION',
  'usage: native-capability-enumeration [--root <dir>] [--docs <file> ...] [--matrix <file>]',
)
const { root, matrix, docs } = parseTargets(process.argv.slice(2), report)
const { rows, core } = loadMatrix(matrix, report.failInput)
if (core.size === 0) report.failInput(`${matrix} declares no core capabilities`)

// The map itself must stay complete and unambiguous: a row twice or never is a
// checker bug that would otherwise hide behind a green run.
const nameOf = new Map()
for (const entry of NAMED) {
  for (const id of entry.ids) {
    if (nameOf.has(id)) report.failInput(`the checker names ${id} under two phrases`)
    nameOf.set(id, entry)
  }
}

const scanned = listDocs({ root, docs }, report.failInput)
const label = labelWithin(root)
const problems = []
let sentences = 0

for (const file of scanned) {
  if (!existsSync(file)) report.failInput(`cannot read ${file}`)
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
    const anchorEnd = flat.indexOf(ANCHOR) + ANCHOR.length
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
      native: flat.slice(anchorEnd, nativeEnd),
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
  report.fail(
    `no capability enumeration sentence found in ${scanned.length} scanned file(s), so this check would verify nothing. ` +
      `Expected "${ANCHOR} … ${NATIVE_MARK} … ${PARTIAL_MARK} … ${ABSENT_MARK}" in docs/platform/native-local.md.`,
  )
}
if (problems.length > 0) {
  report.fail(`CAPABILITY ENUMERATION FAILED: the sentence and ${label(matrix)} disagree.`, problems)
}

const split = { native: 0, partial: 0, absent: 0 }
for (const row of core.values()) split[row.native] += 1
console.log(
  `capability enumeration: ${sentences} sentence(s) name all ${core.size} core rows in their matrix group ` +
    `(${split.native} native, ${split.partial} partial, ${split.absent} absent).`,
)
