import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

// The studio package compiles its scripts as CommonJS, which has no top-level await: such a script fails
// to compile when run with tsx (npm run ...), even though it type-checks. This is how demo:reset was
// found broken. Scripts wrap their work in an async main() instead.
test('no studio script uses top-level await', () => {
  const dir = new URL('../scripts/', import.meta.url)
  const offenders: string[] = []
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const lines = readFileSync(new URL(name, dir), 'utf8').split('\n')
    lines.forEach((line, i) => {
      // column 0 only: anything inside a function is indented
      if (/^(?:const|let|var)\s[^=]*=\s*await\s/.test(line) || /^await\s/.test(line) || /^for await\s/.test(line)) offenders.push(`${name}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [], 'wrap the script body in an async main()')
})

/**
 * quicksilver-seven.vercel.app is the withdrawn challenge build: it answers only / and
 * /decisions, with no API routes. A script that *calls* a deployment must not default to it.
 * This is how `npm run e2e:live` came to test a deployment that had already been retired — the
 * run reached a host that could not serve the calls it made.
 *
 * Prose that documents the challenge build on purpose — docs/DEMO-SCRIPT.md, SUBMISSION.md — is
 * correct and is not covered here. Only code is, and only uses that are not inside a comment, so a
 * comment explaining the withdrawal can still name it.
 */
test('no studio script defaults to the withdrawn challenge deployment', () => {
  const dir = new URL('../scripts/', import.meta.url)
  const offenders: string[] = []
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const code = readFileSync(new URL(name, dir), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/^\s*\/\/.*$/gm, '') // whole-line line comments
      .replace(/\s\/\/[^\n]*$/gm, '') // trailing line comments
      .replace(/^\s*\*.*$/gm, '') // JSDoc continuation lines
    if (code.includes('quicksilver-seven.vercel.app')) offenders.push(name)
  }
  assert.deepEqual(offenders, [], 'a script must not call the withdrawn challenge deployment; use project-quicksilver.vercel.app')
})
