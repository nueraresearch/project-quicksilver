#!/usr/bin/env node
/**
 * The clean-install check: `git clone && npm ci && npm run dev` must start the
 * console with zero external configuration.
 *
 * ADR 0001 (docs/platform/adr-0001-native-first-ownership.md) states that
 * promise as the acceptance criterion for native-first ownership, and a promise
 * with no check that can fail is documentation. This runs three checks:
 *
 *   1. static - resolve what `npm run dev` actually runs and refuse if a
 *               workspace that needs configuration is reachable from it.
 *   2. clean  - when a local .env is present the live check cannot prove a loss
 *               clone, so the promise is reported as **untested** and the exit
 *               code is 2. A skip is not a pass: the run never started the
 *               console, so it must not print that it did.
 *   3. live   - start `npm run dev` with every provider credential removed and
 *               require the console to answer. Studio's refusal is checked too.
 *
 * Credential-free: no provider calls, no keys, no accounts.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const notes = []
const skipped = []
const fail = (message) => failures.push(message)
const note = (message) => notes.push(message)
const skip = (message) => skipped.push(message)
const tail = (text, lines = 12) => text.trim().split('\n').slice(-lines).join('\n')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const readJson = (relative) => JSON.parse(readFileSync(join(root, relative), 'utf8'))
const rootPackage = readJson('package.json')

/** Workspaces whose dev script cannot start without configuration, and what it needs. */
const CONFIG_REQUIRED = new Map([['@quicksilver/studio', 'SANITY_STUDIO_PROJECT_ID']])

/** Anything that would make a "zero configuration" run secretly configured. */
const CREDENTIAL_PREFIXES = [
  'SANITY_', 'NEXT_PUBLIC_SANITY_', 'AZURE_', 'OPENAI_', 'ANTHROPIC_', 'GOOGLE_',
  'OIDC_', 'STRIPE_', 'HUBSPOT_', 'QUICKBOOKS_', 'BRAVE_', 'RESEND_', 'TWILIO_',
  'SLACK_', 'DISCORD_', 'TELEGRAM_', 'DATABASE_URL', 'QUICKSILVER_EMAIL_',
  'QUICKSILVER_SMTP_', 'QUICKSILVER_STRIPE_',
]
const isCredential = (name) => CREDENTIAL_PREFIXES.some((prefix) => name.startsWith(prefix))

/**
 * A minimal environment. The promise is about a clone, not about this shell, so
 * nothing that could configure the app is carried over.
 */
function scrubbedEnv(extra = {}) {
  const keep = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TERM', 'LANG', 'USERPROFILE', 'SYSTEMROOT', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA']
  const env = {}
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key]
  for (const key of Object.keys(env)) if (isCredential(key)) delete env[key]
  return { ...env, NEXT_TELEMETRY_DISABLED: '1', ...extra }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const shell = process.platform === 'win32'

// ── 1. Static: the commands `npm run dev` reaches ────────────────────────

function workspaceNames() {
  const names = new Map()
  for (const pattern of rootPackage.workspaces ?? []) {
    const [parent, child] = pattern.split('/')
    if (child !== '*') continue
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const directory = `${parent}/${entry.name}`
      if (!existsSync(join(root, directory, 'package.json'))) continue
      names.set(readJson(`${directory}/package.json`).name, directory)
    }
  }
  return names
}

/** Every command reachable from `npm run <name>`, following nested `npm run`. */
function reachableCommands(name, seen = new Set()) {
  if (seen.has(name)) return []
  seen.add(name)
  const command = rootPackage.scripts?.[name]
  if (!command) return []
  const nested = [...command.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)]
    .flatMap((match) => reachableCommands(match[1], seen))
  return [command, ...nested]
}

function startedWorkspaces(commands) {
  const started = new Set()
  for (const command of commands) {
    if (/--workspaces\b/.test(command)) {
      for (const name of workspaceNames().keys()) started.add(name)
      continue
    }
    for (const match of command.matchAll(/--workspace[= ]([@A-Za-z0-9/._-]+)/g)) started.add(match[1])
  }
  return started
}

const workspaces = workspaceNames()
const devCommands = reachableCommands('dev')
if (devCommands.length === 0) fail('package.json has no "dev" script')
const started = startedWorkspaces(devCommands)
if (started.size === 0) fail('`npm run dev` does not start any workspace')
if (!started.has('@quicksilver/web')) fail('`npm run dev` must start the web console')
for (const name of started) {
  if (!workspaces.has(name)) fail(`\`npm run dev\` starts an unknown workspace: ${name}`)
}
for (const [name, requirement] of CONFIG_REQUIRED) {
  if (started.has(name)) {
    fail(`\`npm run dev\` starts ${name}, which needs ${requirement}. It belongs to \`npm run dev:all\`.`)
  }
}
if (failures.length === 0) note(`\`npm run dev\` starts only ${[...started].join(', ')}`)

// ── 2. Clean: no local environment files ─────────────────────────────────

const envFiles = ['.env', '.env.local', 'apps/web/.env', 'apps/web/.env.local']
const present = envFiles.filter((relative) => existsSync(join(root, relative)))
if (present.length > 0) {
  skip(`live console start: ${present.join(', ')} exists, so a "no configuration" run would prove the developer's secrets, not a clone`)
}

// ── 3. Live: start the console with nothing configured ───────────────────

function startDev() {
  const child = spawn(npm, ['run', 'dev'], {
    cwd: root,
    env: scrubbedEnv(),
    detached: !shell,
    shell,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const url = new Promise((resolveUrl, rejectUrl) => {
    let settled = false
    let settleTimer = null
    const finish = (done, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (settleTimer) clearTimeout(settleTimer)
      done(value)
    }
    const timer = setTimeout(
      () => finish(rejectUrl, new Error(`the dev server became ready with no usable Local URL within 120s\n${tail(output)}`)),
      120_000,
    )
    const onData = (chunk) => {
      output += String(chunk)
      // Next prints its chosen Local URL before it discovers that another dev
      // server already owns the directory, then exits. Trusting that first line
      // reports a port that was never listening, so name the real cause.
      if (/Another next dev server is already running/.test(output)) {
        const running = /You can access the existing server at (\S+)/.exec(output)?.[1] ?? 'another address'
        finish(rejectUrl, new Error(`another dev server is already running at ${running}; stop it and re-run this check`))
        return
      }
      if (settleTimer || !/Ready in/.test(output)) return
      // Let the next tick print anything that follows Ready before trusting the URL.
      settleTimer = setTimeout(() => {
        const printed = [...output.matchAll(/Local:\s+(http:\/\/\S+)/g)].at(-1)?.[1]?.replace(/\/$/, '')
        if (!printed) finish(rejectUrl, new Error(`the dev server became ready without printing a Local URL\n${tail(output)}`))
        else finish(resolveUrl, printed)
      }, 750)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => finish(rejectUrl, new Error(`the dev server exited with ${code}\n${tail(output)}`)))
  })
  return { child, url }
}

async function stop(child) {
  if (!child.pid || child.exitCode !== null) return
  const signal = (name) => {
    try {
      if (shell) child.kill(name)
      else process.kill(-child.pid, name)
    } catch {
      // Already gone.
    }
  }
  signal('SIGTERM')
  await Promise.race([new Promise((done) => child.once('exit', done)), sleep(5_000)])
  if (child.exitCode === null) {
    signal('SIGKILL')
    await sleep(1_000)
  }
}

async function statusOf(url) {
  try {
    return (await fetch(url, { redirect: 'manual' })).status
  } catch {
    return 0
  }
}

async function waitForStatus(base, path, attempts = 30) {
  let status = 0
  for (let attempt = 0; attempt < attempts; attempt++) {
    status = await statusOf(base + path)
    if (status !== 0) return status
    await sleep(1_000)
  }
  return status
}

async function checkConsole() {
  const dev = startDev()
  try {
    const base = await dev.url
    const pages = ['/', '/sign-in', '/api/auth/status']
    for (const page of pages) {
      const status = await waitForStatus(base, page)
      if (status !== 200) fail(`${base}${page} answered ${status || 'nothing'} with no configuration (expected 200)`)
    }
    if (failures.length === 0) note(`console answered 200 at ${pages.join(', ')} from ${base} with no configuration`)
  } catch (error) {
    fail(error.message)
  } finally {
    await stop(dev.child)
  }
}

// ── 4. Studio refuses and explains, rather than failing inside the CLI ────

async function checkStudioRefusal() {
  const child = spawn(npm, ['run', 'dev', '--workspace=@quicksilver/studio'], {
    cwd: root,
    env: scrubbedEnv(),
    shell,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += String(chunk) })
  child.stderr.on('data', (chunk) => { output += String(chunk) })
  const code = await new Promise((done) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      done('timeout')
    }, 90_000)
    child.on('exit', (value) => {
      clearTimeout(timer)
      done(value)
    })
  })
  if (code === 0) fail('Studio started without SANITY_STUDIO_PROJECT_ID; it must refuse and explain what it needs')
  else if (!output.includes('Zero-config console')) fail(`Studio refused without naming the zero-config path\n${tail(output)}`)
  else note('Studio refuses without its project and names the zero-config console instead')
}

async function main() {
  if (present.length === 0) await checkConsole()
  await checkStudioRefusal()

  for (const message of notes) console.log(`  ok    ${message}`)
  for (const message of skipped) console.error(`  SKIP  ${message}`)
  for (const message of failures) console.error(`  FAIL  ${message}`)
  if (failures.length > 0) {
    console.error(`\nCLEAN INSTALL CHECK FAILED: ${failures.length} problem(s)`)
    process.exit(1)
  }
  // A check that declined to verify is neither a pass nor a failure. Exiting 2
  // keeps it visible to a human and to CI without pretending the clone worked.
  if (skipped.length > 0) {
    console.error(`\nCLEAN INSTALL CHECK SKIPPED: ${skipped.length} check(s) did not run, so the promise is unverified. This is not a pass.`)
    console.error('Run it in a clean clone, or move the environment file aside, to verify the promise.')
    process.exit(2)
  }
  console.log('\nCLEAN INSTALL CHECK PASSED: `npm run dev` starts with zero external configuration.')
}

main().catch((error) => {
  console.error(`CLEAN INSTALL CHECK FAILED: ${error?.stack ?? error}`)
  process.exit(1)
})
