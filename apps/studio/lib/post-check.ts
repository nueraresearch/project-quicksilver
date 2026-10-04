/**
 * The checks behind `npm run demo:post-check`: pure functions over the text of the dev.to post. The one access
 * token the post is meant to carry is allowed; any other secret-shaped string, leftover placeholder or editing
 * note is a finding. Findings never include the matched text, so the output is safe to paste anywhere.
 */
import type { Finding } from './demo-preflight.ts'

const pass = (text: string): Finding => ({ level: 'pass', text })
const warn = (text: string): Finding => ({ level: 'warn', text })
const fail = (text: string): Finding => ({ level: 'fail', text })

const ACCESS_TOKEN = /\bqs_[A-Za-z0-9_-]{20,}/g
/** Built from parts so no credential-shaped literal sits in the source. */
const OTHER_SECRETS: ReadonlyArray<[string, RegExp]> = [
  ['a GitHub token', new RegExp(`\\bgh[pousr]_${'[A-Za-z0-9]{30,}'}`)],
  ['a Resend API key', new RegExp(`\\bre_${'[A-Za-z0-9_]{20,}'}`)],
  ['a Sanity or OpenAI style secret key', new RegExp(`\\bsk[-_][A-Za-z0-9_-]{20,}`)],
  ['a private key block', new RegExp(`-----BEGIN [A-Z ]*PRIVATE KEY-----`)],
  ['an environment assignment of a secret', /\b(?:QUICKSILVER_[A-Z_]*(?:KEY|TOKEN|PRINCIPALS)|SANITY_[A-Z_]*TOKEN|AZURE_[A-Z_]*KEY)\s*=\s*\S+/],
]

export function frontMatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out: Record<string, string> = {}
  if (!m) return out
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '')
  }
  return out
}

export function urlsIn(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s)>\]"'`]+/g) ?? []).map((u) => u.replace(/[.,;:]+$/, '')))]
}

export function checkPost(text: string): Finding[] {
  const out: Finding[] = []
  const fm = frontMatter(text)

  if (!fm.title) out.push(fail('Front matter: no title.'))
  else if (fm.title.length > 128) out.push(fail(`Front matter: the title is ${fm.title.length} characters; keep it under 128.`))
  const tags = (fm.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  if (tags.length === 0) out.push(fail('Front matter: no tags.'))
  if (tags.length > 4) out.push(fail(`Front matter: ${tags.length} tags; dev.to allows 4.`))
  if (!tags.includes('sanitychallenge')) out.push(fail('Front matter: the tag sanitychallenge is missing, so the post will not count as an entry.'))
  if (tags.some((t) => !/^[a-z0-9]+$/i.test(t))) out.push(fail('Front matter: tags may contain letters and digits only.'))
  if (!fm.cover_image) out.push(warn('Front matter: no cover_image.'))

  const fills = text.match(/\[FILL[^\]]*\]/g) ?? []
  out.push(fills.length ? fail(`${fills.length} placeholder(s) still say [FILL ...]. Replace each one.`) : pass('No [FILL] placeholders remain.'))

  if (/BEFORE PUBLISHING/.test(text)) out.push(fail('The "BEFORE PUBLISHING" editing note is still in the post. Delete that comment block.'))

  const tokens = text.match(ACCESS_TOKEN) ?? []
  if (tokens.length === 0) out.push(fail('The post carries no access token (qs_...). Judges need it to sign in.'))
  else if (tokens.length > 1 && new Set(tokens).size > 1) out.push(fail('The post carries more than one distinct access token. It should hold only the judge token.'))
  else out.push(pass('The post carries one access token, as intended (it is not shown here).'))

  for (const [what, pattern] of OTHER_SECRETS) if (pattern.test(text)) out.push(fail(`The post contains ${what}. Remove it before publishing.`))

  const urls = urlsIn(text)
  if (!urls.some((u) => u.includes('project-quicksilver.vercel.app'))) out.push(fail('The post does not link the live app, https://project-quicksilver.vercel.app.'))
  if (urls.some((u) => /quicksilver-seven\.vercel\.app/.test(u))) out.push(fail('The post still links the withdrawn entry, quicksilver-seven.vercel.app.'))
  if (urls.some((u) => /localhost|127\.0\.0\.1/.test(u))) out.push(fail('The post links a local address.'))
  if (!/f87t11g1/.test(text)) out.push(fail('The Sanity project ID f87t11g1 is missing.'))
  if (!/github\.com\/nueraresearch\/project-quicksilver/.test(text)) out.push(fail('The repository link is missing.'))
  if (!/walkthrough video/i.test(text) || !urls.some((u) => /youtu|vimeo|loom|dev\.to|drive\.google|vimeocdn/.test(u))) out.push(warn('No video link was recognised (YouTube, Vimeo, Loom, Drive or a dev.to embed). Check by eye.'))
  if (!out.some((f) => f.level === 'fail')) out.push(pass('Front matter, links and secrets look right.'))
  return out
}

export function checkLinkStatus(url: string, status: number): Finding[] {
  if (status === 0) return [fail(`${url}: could not be reached.`)]
  if (status >= 400) return [fail(`${url}: answered ${status}.`)]
  return []
}
