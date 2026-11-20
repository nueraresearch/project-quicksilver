#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The body digest for an architecture decision record (ADR 0001, "Status and
 * amendment").
 *
 * What it prevents: an accepted record's body changing without the change being
 * visible as such, so a decision log slowly stops describing what was decided
 * while still reading like a decision.
 *
 * What it does not prevent: a deliberate rewrite. Anyone who can commit can run
 * `npm run adr:seal`. The digest makes a rewrite impossible to make *silently*,
 * not impossible to make; review and git history remain the authority.
 *
 * The mutable lines are excluded, so recording a supersession never requires
 * resealing. Everything else is covered, including the header facts (date and
 * deciders are history, not opinion) and every heading and paragraph.
 *
 * Canonicalisation is limited to formatting so the check is stable across
 * platforms and editors: CRLF is folded to LF, trailing whitespace and trailing
 * blank lines are dropped. Reflowing a paragraph is a content change, and is
 * meant to be caught.
 *
 * A bare run (`npm run adr:seal`) seals accepted records and leaves Proposed
 * ones alone: nothing is accepted until it is accepted, and a digest on a
 * proposal would make an unsettled decision look frozen. Naming a file seals it
 * whatever its status, because that is an explicit request.
 */
const MUTABLE = [/^- \*\*Status:\*\*/, /^- \*\*Superseded by:\*\*/, /^- \*\*Body digest:\*\*/]

const DIGEST_LINE = /^- \*\*Body digest:\*\*.*$/m
const ANCHOR_LINE = /^- \*\*Superseded by:\*\*.*$/m
const STATUS_LINE = /^- \*\*Status:\*\*[ \t]*(.*)$/m

function statusOf(text) {
  return STATUS_LINE.exec(text)?.[1]?.trim() ?? ''
}

export function canonicalBody(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !MUTABLE.some((pattern) => pattern.test(line)))
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n*$/, '\n')
}

export function bodyDigest(text) {
  return `sha256:${createHash('sha256').update(canonicalBody(text), 'utf8').digest('hex')}`
}

/** Returns the record with its digest line set to the digest of its body. */
export function withDigest(text) {
  const normalized = text.replace(/\r\n?/g, '\n')
  const line = `- **Body digest:** ${bodyDigest(normalized)}`
  if (DIGEST_LINE.test(normalized)) return normalized.replace(DIGEST_LINE, line)
  if (!ANCHOR_LINE.test(normalized)) {
    throw new Error('record has no "Superseded by" line to anchor the digest after')
  }
  return normalized.replace(ANCHOR_LINE, (match) => `${match}\n${line}`)
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const directory = fileURLToPath(new URL('../docs/platform/', import.meta.url))
  const explicit = process.argv.slice(2)
  const targets = explicit.length
    ? explicit.map((argument) => resolve(argument))
    : readdirSync(directory)
        .filter((name) => /^adr-\d{4}-[a-z0-9-]+\.md$/.test(name))
        .map((name) => join(directory, name))

  if (targets.length === 0) {
    console.error('no architecture decision records found')
    process.exit(1)
  }

  for (const file of targets) {
    const before = readFileSync(file, 'utf8')
    if (explicit.length === 0 && statusOf(before) === 'Proposed') {
      console.log(`proposed   ${file}  (left unsealed: only accepted records are sealed; name the file to seal it anyway)`)
      continue
    }
    const after = withDigest(before)
    if (after === before) {
      console.log(`unchanged  ${file}`)
      continue
    }
    writeFileSync(file, after)
    console.log(`sealed     ${file}  ${bodyDigest(after)}`)
  }
  console.log('\nA changed digest belongs in the diff: say why the body changed.')
}
