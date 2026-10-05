/**
 * Check the dev.to post text before you publish it. Reads the file you give it (your final text, with the judge
 * token pasted in) and prints PASS, WARN or FAIL. It never prints the token or any other secret it finds.
 * Add --online to also request every link once and report the ones that do not load. Exits 1 on any FAIL.
 *
 *   npm run demo:post-check -- --file C:\path\to\final-post.md --online
 *
 * Use an absolute path (npm runs this from apps/studio). Keep the final file outside the repository so the token is never committed.
 */
import { readFileSync } from 'node:fs'
import { checkLinkStatus, checkPost, urlsIn } from '../lib/post-check.ts'
import { hasFailure, type Finding } from '../lib/demo-preflight.ts'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const show = (findings: Finding[]) => {
  for (const f of findings) console.log(`${f.level === 'pass' ? 'PASS' : f.level === 'warn' ? 'WARN' : 'FAIL'}  ${f.text}`)
}

async function main(): Promise<void> {
  const file = arg('--file')
  if (!file) throw new Error('Pass --file <path to the final post text>')
  const text = readFileSync(file, 'utf8')
  const all = checkPost(text)
  show(all)
  if (process.argv.includes('--online')) {
    for (const url of urlsIn(text)) {
      let status = 0
      try {
        status = (await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20_000) })).status
      } catch { /* status stays 0 */ }
      const f = checkLinkStatus(url, status)
      show(f); all.push(...f)
    }
    console.log('Links checked.')
  }
  if (hasFailure(all)) process.exit(1)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
