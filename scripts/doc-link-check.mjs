#!/usr/bin/env node
/**
 * Cross-reference check for hand-written documentation.
 *
 * Every tracked markdown file is in scope — the root README, CONTRIBUTING,
 * ARCHITECTURE and the package READMEs link into `docs/` by path just as `docs/`
 * links to itself, and they go stale the same way when a file moves or a
 * heading is renamed. A relative link must resolve to an existing file, and a
 * `#fragment` on a markdown target must match a heading slug or an explicit
 * `<a id="...">`. External URLs are never fetched. Code is not documentation:
 * a `#` line or a link in a fenced block, an inline code span or an HTML comment
 * is not a reference.
 *
 * It fails closed: a tree with no markdown, or with no links at all, exits 2
 * rather than passing over nothing. Exit 1 means at least one reference is
 * broken; 0 is the only pass.
 *
 * Known limits: two headings that slug identically are not distinguished, an
 * unmatched backtick blanks the rest of its line, and whether a linked page says
 * the right thing is not checked.
 *
 *   node scripts/doc-link-check.mjs [--root <dir>]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Only reached outside a git checkout. Dot-directories are build output,
// caches and vendored toolchains; none of it is hand-written documentation.
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist'])
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

class InputError extends Error {}

/** GitHub-style heading slug. Punctuation is dropped; spaces become hyphens. */
function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/ /g, '-')
}

/** Spaces of the same length, so masking never shifts a column or joins words. */
const blank = (text) => ' '.repeat(text.length)

/**
 * One line split into what can appear in documentation: `prose` keeps inline
 * code spans, because a heading's code is part of its slug, and drops HTML
 * comments; `masked` drops both. A comment left open continues on the next line.
 */
function maskInline(text, state) {
  let prose = ''
  let masked = ''
  let index = 0
  while (index < text.length) {
    if (state.comment) {
      const end = text.indexOf('-->', index)
      const stop = end === -1 ? text.length : end + 3
      prose += blank(text.slice(index, stop))
      masked += blank(text.slice(index, stop))
      index = stop
      if (end !== -1) state.comment = false
      continue
    }
    const comment = text.indexOf('<!--', index)
    const code = text.indexOf('`', index)
    if (comment !== -1 && (code === -1 || comment < code)) {
      prose += text.slice(index, comment)
      masked += text.slice(index, comment)
      prose += blank('<!--')
      masked += blank('<!--')
      state.comment = true
      index = comment + 4
      continue
    }
    if (code !== -1) {
      const run = text.slice(code).match(/^`+/)[0]
      // A closer is a run of exactly the opening run's length; a longer run is literal.
      const closer = [...text.slice(code + run.length).matchAll(/`+/g)].find((match) => match[0].length === run.length)
      const stop = closer ? code + run.length + closer.index + run.length : text.length
      prose += text.slice(index, stop)
      masked += text.slice(index, code) + blank(text.slice(code, stop))
      index = stop
      continue
    }
    prose += text.slice(index)
    masked += text.slice(index)
    break
  }
  return { prose, masked }
}

/**
 * The lines outside fenced code blocks, in document order. Fenced blocks open on
 * three or more backticks or tildes and close on the same character, at least as
 * long, alone on the line.
 */
function proseLines(markdown) {
  const lines = []
  const state = { comment: false }
  let fence = null
  markdown.split('\n').forEach((text, index) => {
    if (fence) {
      // A closing fence repeats the character, is at least as long, and stands alone.
      const closing = text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null
      return
    }
    if (!state.comment) {
      const opening = text.match(/^ {0,3}(`{3,}|~{3,})/)
      if (opening) {
        fence = opening[1]
        return
      }
    }
    lines.push({ ...maskInline(text, state), number: index + 1 })
  })
  return lines
}

/** Heading slugs and explicit ids. */
function anchorIds(markdown) {
  const anchors = []
  for (const { prose, masked } of proseLines(markdown)) {
    const heading = prose.match(/^#{1,6}[ \t]+(.+?)[ \t]*$/)
    if (heading) anchors.push(slug(heading[1]))
    for (const match of masked.matchAll(/<a[^>]+id=["']([^"']+)["']/gi)) anchors.push(match[1])
  }
  return new Set(anchors)
}

function markdownFiles(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue
      markdownFiles(path, out)
    } else if (entry.name.endsWith('.md')) {
      out.push(path)
    }
  }
  return out
}

/** Inline markdown links only; reference-style links and autolinks are ignored. */
function linksIn(markdown) {
  const found = []
  for (const { masked, number } of proseLines(markdown)) {
    for (const match of masked.matchAll(/\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
      found.push({ target: match[1], line: number })
    }
  }
  return found
}

/**
 * The tracked markdown files, or null outside a git checkout, where tracked and
 * untracked are not a distinction. Returning an empty set there would silently
 * check nothing.
 */
function trackedMarkdown(base) {
  const listed = spawnSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: base, encoding: 'utf8' })
  if (listed.error || listed.status !== 0) return null
  return listed.stdout
    .split('\0')
    .filter(Boolean)
    .map((path) => resolve(base, path))
}

function checkReferences(root) {
  const base = resolve(root)
  // The tracked list is what the repository is, so a draft that was never added
  // cannot turn the suite red. Outside a checkout the tree has no such list and
  // is walked instead.
  let files
  try {
    files = (trackedMarkdown(base) ?? markdownFiles(base)).filter((path) => existsSync(path))
  } catch (error) {
    throw new InputError(`cannot read ${base}: ${error.code === 'ENOENT' ? 'does not exist' : error.code ?? 'unreadable'}`)
  }
  if (files.length === 0) throw new InputError(`no markdown files found under ${base}`)

  const anchorCache = new Map()
  const anchorsOf = (path) => {
    if (!anchorCache.has(path)) anchorCache.set(path, anchorIds(readFileSync(path, 'utf8')))
    return anchorCache.get(path)
  }

  const broken = []
  let links = 0
  for (const file of files) {
    for (const { target, line } of linksIn(readFileSync(file, 'utf8'))) {
      if (EXTERNAL.test(target)) continue
      links += 1
      const at = `${relative(root, file)}:${line}`
      const hash = target.indexOf('#')
      const [pathPart, fragment] = hash === -1 ? [target, ''] : [target.slice(0, hash), target.slice(hash + 1)]
      let destination = file
      if (pathPart) {
        try {
          const decoded = decodeURI(pathPart.split('?')[0])
          // `/docs/x.md` is repository-root-relative in rendered markdown.
          destination = decoded.startsWith('/') ? join(base, decoded) : join(dirname(file), decoded)
        } catch {
          broken.push({ at, target, reason: 'unreadable link target' })
          continue
        }
        try {
          readFileSync(destination)
        } catch (error) {
          broken.push({ at, target, reason: error.code === 'ENOENT' ? 'file does not exist' : 'file is unreadable' })
          continue
        }
      }
      if (!fragment) continue
      if (!destination.endsWith('.md')) {
        broken.push({ at, target, reason: 'anchor on a non-markdown target' })
      } else if (!anchorsOf(destination).has(fragment)) {
        broken.push({ at, target, reason: 'no heading or id with that anchor' })
      }
    }
  }

  if (links === 0) throw new InputError(`no cross-references found under ${base}`)
  return { files: files.length, links, broken }
}

function main() {
  const args = process.argv.slice(2)
  const rootFlag = args.indexOf('--root')
  const root = rootFlag === -1 ? fileURLToPath(new URL('../', import.meta.url)) : args[rootFlag + 1]
  if (!root) throw new InputError('--root needs a directory')

  const result = checkReferences(root)
  console.log(`doc links: ${result.files} file(s), ${result.links} link(s), ${result.broken.length} broken`)
  if (result.broken.length === 0) {
    console.log('DOC LINK CHECK PASSED')
    return 0
  }
  for (const entry of result.broken) console.log(`  ${entry.at} -> ${entry.target} (${entry.reason})`)
  console.log('DOC LINK CHECK FAILED: fix the reference or the heading it points at. This is not a pass.')
  return 1
}

try {
  process.exitCode = main()
} catch (error) {
  if (!(error instanceof InputError)) throw error
  console.error(`DOC LINK CHECK FAILED (input): ${error.message}`)
  console.error('Nothing was verified. This is not a pass.')
  process.exitCode = 2
}
