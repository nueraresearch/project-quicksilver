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
