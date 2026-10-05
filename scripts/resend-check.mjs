/**
 * Resend preflight (P-022 / P-095).
 *
 * The email adapters were written and tested against a fake API, and every
 * place that reports on them says the same thing: "no real send is recorded".
 * That single missing fact is what keeps those rows partial. This script makes
 * the gap closable in three steps, cheapest first:
 *
 *   node scripts/resend-check.mjs                 config only, no network
 *   node scripts/resend-check.mjs --live          prove the key works (read-only)
 *   node scripts/resend-check.mjs --send a@b.com  one real send, prints the id
 *
 * The first form never touches the network and never prints a secret, so it is
 * safe to run in CI or in front of a screen. `--send` deliberately requires the
 * recipient as an argument and refuses any address that is not on the policy's
 * allow-list, so a stray run cannot mail a stranger.
 */
import { readFileSync, existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const RESEND_API = 'https://api.resend.com'
const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/

// Resend will not send from a public mail provider: "Resend sends emails using a
// domain you own (i.e. not a shared or public domain)". Asking to send from
// gmail.com earns a 403 validation_error, which reads like a key problem and is
// not one, so it is worth naming before the first send.
//
// The provider must be the *real* domain, not just a leading label. `mail.com`
// is a provider and `mail.nueraresearch.com` is a subdomain Resend tells you to
// verify, and a naive `^mail\.` test refuses the second while allowing the
// first — the wrong way round for the mistake people actually make.
const PUBLIC_MAIL_EXACT = new Set(['mail.com', 'mail.ru', 'gmx.de', 'yandex.ru', 'yahoo.co.uk', 'hotmail.co.uk', 'live.co.uk', 'aol.co.uk'])
const PUBLIC_MAIL_LABEL = /(^|\.)(gmail|googlemail|outlook|hotmail|yahoo|live|msn|icloud|me|maco?x|aol|proton|protonmail|fastmail|gmx|yandex|zoho)\.[a-z]{2,}$/

function isPublicMail(domain) {
  return PUBLIC_MAIL_EXACT.has(domain) || PUBLIC_MAIL_LABEL.test(domain)
}

const RESEND_TEST_DOMAIN = 'resend.dev'

/** 'ok' | 'warn' | 'fail' — a warn still passes the preflight but is worth reading. */
export function sendingDomainVerdict(from) {
  if (typeof from !== 'string' || !ADDRESS.test(from)) return { level: 'fail', detail: 'not a valid address' }
  const domain = from.trim().toLowerCase().split('@')[1]
  if (isPublicMail(domain)) {
    return {
      level: 'fail',
      detail: `${domain} is a public mail provider, and Resend only sends from a domain you own — this would be refused with a 403. Verify a domain at resend.com/domains (any subdomain you control works), or send one confirming test from onboarding@${RESEND_TEST_DOMAIN} to your own Resend address.`,
    }
  }
  // Usable, but only for a single test to the account owner, so say so loudly
  // rather than letting a real notice quietly fail later.
  if (domain === RESEND_TEST_DOMAIN) {
    return { level: 'warn', detail: `onboarding@${RESEND_TEST_DOMAIN} can only ever reach the address on your Resend account. Fine for the first test; not for real notices.` }
  }
  return { level: 'ok', detail: `${domain} is not a public mail provider — Resend still has to have it verified.` }
}

/** Mirrors packages/host/src/main.ts loadEnvFiles, plus the Next.js `.env.local`. Real variables win. */
function loadEnvFiles(startDir) {
  const loaded = []
  let dir = resolve(startDir)
  for (let i = 0; i < 6; i++) {
    for (const name of ['.env.local', '.env']) {
      const candidate = resolve(dir, name)
      if (!existsSync(candidate)) continue
      for (const line of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (!match || process.env[match[1]] !== undefined) continue
        process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2')
      }
      loaded.push(candidate)
    }
    const up = resolve(dir, '..')
    if (up === dir) break
    dir = up
  }
  return loaded
}

/** Same rule as packages/host/src/tool-adapters.ts emailRecipientAllowed, kept in step with it. */
export function emailRecipientAllowed(to, allowed) {
  const address = to.trim().toLowerCase()
  if (!ADDRESS.test(address)) return false
  return allowed.some((entry) => {
    const e = entry.trim().toLowerCase()
    return e.startsWith('@') ? address.endsWith(e) && address.split('@').length === 2 : address === e
  })
}

/**
 * Everything that can be decided without the network. Returns a list of
 * `{ name, ok, detail }` so a caller can render it; `ok: false` always carries
 * a `detail` naming the exact variable or file to fix.
 */
export function runChecks(env, readJson) {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail })

  const key = env.QUICKSILVER_EMAIL_API_KEY?.trim()
  add('operator channel: QUICKSILVER_EMAIL_API_KEY is set', Boolean(key), key ? `set (${key.length} chars, never printed)` : 'set it in .env — resend.com → API Keys → Sending access')

  const from = env.QUICKSILVER_EMAIL_FROM?.trim()
  add('QUICKSILVER_EMAIL_FROM is a valid address', Boolean(from && ADDRESS.test(from)), from || 'set the verified sending address, e.g. quicksilver@your-domain')
  const fromVerdict = sendingDomainVerdict(from ?? '')
  add('QUICKSILVER_EMAIL_FROM is a domain Resend can send from', fromVerdict.level !== 'fail', fromVerdict.detail)

  const secret = env.QUICKSILVER_EMAIL_INBOUND_SECRET?.trim()
  add('QUICKSILVER_EMAIL_INBOUND_SECRET is 32+ characters', Boolean(secret && secret.length >= 32), secret ? `${secret.length} characters` : 'a random 32+ character string; it signs inbound webhooks, so do not reuse the API key')

  // The operator channel only needs the three above; the approved-action tool
  // additionally needs a policy file naming the key and the recipient allow-list.
  const configName = env.QUICKSILVER_ACTIONS_CONFIG?.trim()
  if (!configName) {
    add('QUICKSILVER_ACTIONS_CONFIG is set', false, 'the notification.send tool stays a dry run without it — copy deploy/actions/actions.example.json and set this')
    return checks
  }
  add('QUICKSILVER_ACTIONS_CONFIG is set', true, configName)

  const policy = readJson(configName)
  if (!policy) {
    add(`${configName} is readable JSON`, false, 'the file is missing or is not valid JSON; the action routes log an error and stay off')
    return checks
  }
  add(`${configName} is readable JSON`, true, configName)

  const email = policy.email
  if (!email || typeof email !== 'object') {
    add('the policy has an `email` block', false, 'without it notification.send stays a dry run')
    return checks
  }
  add('the policy has an `email` block', true, 'present')

  add('policy email.from is a valid address', typeof email.from === 'string' && ADDRESS.test(email.from), String(email.from ?? 'missing'))
  const policyVerdict = sendingDomainVerdict(typeof email.from === 'string' ? email.from : '')
  add('policy email.from is a domain Resend can send from', policyVerdict.level !== 'fail', policyVerdict.detail)

  const recipients = Array.isArray(email.recipients) ? email.recipients.filter((r) => typeof r === 'string') : []
  add('policy email.recipients is a non-empty list', recipients.length > 0, recipients.length ? `${recipients.length} allowed: ${recipients.join(', ')}` : 'add at least one address or whole domain ("@your-domain") — this list is the only thing notification.send may reach')

  const keyEnv = typeof email.apiKeyEnv === 'string' ? email.apiKeyEnv : 'QUICKSILVER_EMAIL_API_KEY'
  add('policy email.apiKeyEnv is an environment variable name', ENV_NAME.test(keyEnv), keyEnv)
  // The policy usually points at the same variable the operator channel already
  // checked. Re-reporting it would show one problem twice under one name, so only
  // a policy that names something else gets its own check.
  if (keyEnv !== 'QUICKSILVER_EMAIL_API_KEY') {
    add(`policy: ${keyEnv} is set`, Boolean(env[keyEnv]?.trim()), env[keyEnv]?.trim() ? 'set' : 'the policy points at this name but the environment has no value for it')
  }

  const enabled = Array.isArray(policy.enabledTools) ? policy.enabledTools : []
  add('enabledTools includes notification.send', enabled.includes('notification.send'), enabled.length ? enabled.join(', ') : 'enabledTools is empty, so no action can run at all')

  return checks
}

/** The signing key for approval grants. Absent, the routes exist but nothing can be authorized. */
export function authorizationCheck(env, hostConfig) {
  const name = typeof hostConfig?.execution?.authorizationKeyEnv === 'string' ? hostConfig.execution.authorizationKeyEnv : 'QUICKSILVER_AUTHORIZATION_KEY'
  return { name, ok: Boolean(env[name]?.trim()), detail: env[name]?.trim() ? 'set' : `unset, so approval grants cannot be signed — set ${name}` }
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

async function main() {
  const args = process.argv.slice(2)
  const baseDir = process.env.INIT_CWD ?? process.cwd()
  loadEnvFiles(baseDir)

  const policyName = process.env.QUICKSILVER_ACTIONS_CONFIG?.trim()
  const policyPath = policyName ? (isAbsolute(policyName) ? policyName : resolve(baseDir, policyName)) : ''
  const hostName = process.env.QUICKSILVER_HOST_CONFIG?.trim() || 'quicksilver.host.json'
  const hostPath = isAbsolute(hostName) ? hostName : resolve(baseDir, hostName)
  const hostConfig = readJsonFile(hostPath)

  const checks = runChecks(process.env, (name) => (name === policyName ? readJsonFile(policyPath) : undefined))
  if (checks.every((c) => c.ok) && existsSync(hostPath)) checks.push(authorizationCheck(process.env, hostConfig))

  console.log('\nResend preflight — no network, no secrets printed\n')
  for (const c of checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}\n        ${c.detail}`)
  const failed = checks.filter((c) => !c.ok)
  if (failed.length) {
    console.log(`\n${failed.length} check(s) failed. Nothing above this point can send mail yet.\n`)
    process.exit(1)
  }
  console.log('\nConfiguration is coherent. Next: --live to prove the key, then --send <recipient>.\n')

  const key = process.env.QUICKSILVER_EMAIL_API_KEY.trim()
  const from = process.env.QUICKSILVER_EMAIL_FROM.trim()
  const policy = readJsonFile(policyPath)
  const recipients = policy.email.recipients.map(String)

  if (args.includes('--live')) {
    // GET /domains only reads. It proves the key is real and shows whether the
    // sending domain is actually verified, which is the usual reason a first
    // send is rejected.
    //
    // A correctly-scoped key cannot do this. Resend scopes keys by purpose and
    // the key this project asks for is "Sending access", which is refused here
    // with a 401 that is indistinguishable from a bad key:
    //   "This API key is restricted to only send emails"
    // Resend has no validate-the-key endpoint a send-scoped key may call, so
    // report the restriction as the expected answer and let --send be the proof.
    const res = await fetch(`${RESEND_API}/domains`, { headers: { authorization: `Bearer ${key}` } })
    const body = await res.json().catch(() => ({}))
    const message = String(body?.message ?? '')
    if (!res.ok && res.status === 401 && /restrict/i.test(message)) {
      console.log('Key accepted as send-only — Resend refused the read with "restricted to only send emails".')
      console.log('That is the right scope for this project, and it means this key cannot list domains.')
      console.log('A send is the only end-to-end proof: --send <recipient on the allow-list>.')
    } else if (!res.ok) {
      console.error(`Resend rejected the key: HTTP ${res.status} ${message}`)
      process.exit(1)
    } else {
      const domains = Array.isArray(body?.data) ? body.data : []
      const sending = from.split('@')[1]
      const verified = domains.some((d) => d?.name === sending && d?.status === 'verified')
      console.log(`Key accepted with domain read access. ${domains.length} domain(s) on the account.`)
      for (const d of domains) console.log(`  ${d?.name} — ${d?.status}`)
      if (from.toLowerCase().endsWith(`@${RESEND_TEST_DOMAIN}`)) {
        console.log(`\n${RESEND_TEST_DOMAIN} is not an account domain, which is expected: it is a shared test domain.`)
      } else if (!verified) {
        console.error(`\n${sending} is not verified on this account. Resend will refuse a send from it.`)
        process.exit(1)
      } else {
        console.log(`\n${sending} is verified; a send should be accepted.`)
      }
    }
  }

  const sendIndex = args.indexOf('--send')
  if (sendIndex !== -1) {
    const recipient = args[sendIndex + 1]
    if (!recipient || recipient.startsWith('--')) {
      console.error(`--send needs a recipient on the policy allow-list. Allowed: ${recipients.join(', ')}`)
      process.exit(1)
    }
    if (!emailRecipientAllowed(recipient, recipients)) {
      console.error(`Refusing to send: ${recipient} is not on the policy allow-list (${recipients.join(', ')}).`)
      process.exit(1)
    }
    console.log(`\nSending one real email to ${recipient} from ${from}…`)
    const res = await fetch(`${RESEND_API}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: 'Quicksilver Resend preflight',
        text: `Sent by "npm run resend:check -- --send" at ${new Date().toISOString()} to confirm the approved-action email path delivers. No action was taken.`,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error(`Resend refused the send: HTTP ${res.status} ${body?.message ?? ''}`)
      process.exit(1)
    }
    console.log(`Delivered. Resend message id: ${body?.id ?? '(not reported)'}`)
    console.log('Record this id and the date in docs/platform/parity-tests.md to close the "no real send is recorded" gap on P-022/P-095.')
  }
}

// Compared through pathToFileURL, not by string-building the URL: on Windows
// `import.meta.url` is file:///C:/... while "file://" + argv[1] is
// file://C:/..., so a hand-built comparison silently never runs main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
