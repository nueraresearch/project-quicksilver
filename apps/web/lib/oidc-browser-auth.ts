import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mapVerifiedOidcIdentity, parseOidcIdentityBindings, verifyOidcIdToken } from './oidc-identities.ts'
import { digestAuthSecret, oidcSessionStore, type OidcSessionStore } from './oidc-session-store.ts'

export const OIDC_SESSION_COOKIE = '__Host-quicksilver-session'
export const OIDC_LOGIN_COOKIE = '__Host-quicksilver-oidc'
const LOGIN_TTL_MS = 10 * 60_000
const SESSION_TTL_MS = 8 * 60 * 60_000
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024

export interface OidcBrowserEnv {
  OIDC_ISSUER?: string
  OIDC_CLIENT_ID?: string
  OIDC_CLIENT_SECRET?: string
  OIDC_REDIRECT_URI?: string
  QUICKSILVER_OIDC_USERS?: string
  QUICKSILVER_TENANT_ID?: string
  NODE_ENV?: string
}

interface OidcProviderMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  response_types_supported?: string[]
  code_challenge_methods_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
}

export interface OidcAuthDependencies {
  store?: OidcSessionStore
  fetcher?: typeof fetch
  now?: () => Date
  random?: (bytes: number) => Buffer
}

function randomToken(bytes: number, random: (bytes: number) => Buffer): string {
  return random(bytes).toString('base64url')
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function httpsUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null
    return url
  } catch { return null }
}

function configFrom(env: OidcBrowserEnv): { issuer: string; clientId: string; clientSecret: string; redirectUri: string } | null {
  const issuerUrl = httpsUrl(env.OIDC_ISSUER)
  const redirectUrl = httpsUrl(env.OIDC_REDIRECT_URI)
  if (!issuerUrl || !redirectUrl || !env.OIDC_CLIENT_ID?.trim() || !env.OIDC_CLIENT_SECRET
    || env.OIDC_CLIENT_SECRET.length < 8) return null
  if (issuerUrl.search || redirectUrl.search || redirectUrl.hash) return null
  return {
    issuer: issuerUrl.href.replace(/\/$/, ''),
    clientId: env.OIDC_CLIENT_ID.trim(),
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: redirectUrl.href,
  }
}

/**
 * Why sign-in is not configured, as setting names and reasons only; never a value. Empty when the
 * settings are usable. Logged when a login cannot even start, which otherwise looks like any failure.
 */
export function oidcConfigProblems(env: OidcBrowserEnv): string[] {
  const problems: string[] = []
  const url = (name: 'OIDC_ISSUER' | 'OIDC_REDIRECT_URI') => {
    const raw = env[name]
    if (!raw?.trim()) { problems.push(`${name}: missing or blank`); return }
    const parsed = httpsUrl(raw)
    if (!parsed) problems.push(`${name}: must be an https URL with no username, password or fragment`)
    else if (parsed.search || parsed.hash) problems.push(`${name}: must not contain a query string or fragment`)
  }
  url('OIDC_ISSUER')
  url('OIDC_REDIRECT_URI')
  if (!env.OIDC_CLIENT_ID?.trim()) problems.push('OIDC_CLIENT_ID: missing or blank')
  if (!env.OIDC_CLIENT_SECRET) problems.push('OIDC_CLIENT_SECRET: missing or blank')
  else if (env.OIDC_CLIENT_SECRET.length < 8) problems.push('OIDC_CLIENT_SECRET: shorter than 8 characters')
  return problems
}

function logNotConfigured(env: OidcBrowserEnv): void {
  console.error('[oidc] sign-in is not configured', JSON.stringify({ problems: oidcConfigProblems(env) }))
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_PROVIDER_RESPONSE_BYTES) throw new Error('OIDC provider response exceeded the size limit.')
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_PROVIDER_RESPONSE_BYTES) throw new Error('OIDC provider response exceeded the size limit.')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OIDC provider response was malformed.')
  return value as Record<string, unknown>
}

async function providerMetadata(issuer: string, fetcher: typeof fetch): Promise<OidcProviderMetadata> {
  const discoveryUrl = new URL(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
  const response = await fetcher(discoveryUrl, { redirect: 'error', signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('OIDC provider discovery failed.')
  const body = await boundedJson(response)
  const authorization = typeof body.authorization_endpoint === 'string' ? httpsUrl(body.authorization_endpoint) : null
  const token = typeof body.token_endpoint === 'string' ? httpsUrl(body.token_endpoint) : null
  const jwks = typeof body.jwks_uri === 'string' ? httpsUrl(body.jwks_uri) : null
  if (body.issuer !== issuer || !authorization || !token || !jwks
    || !Array.isArray(body.response_types_supported) || !body.response_types_supported.includes('code')
    || !Array.isArray(body.code_challenge_methods_supported) || !body.code_challenge_methods_supported.includes('S256')) {
    throw new Error('OIDC provider metadata is incomplete or does not match the configured issuer.')
  }
  if (body.token_endpoint_auth_methods_supported !== undefined
    && (!Array.isArray(body.token_endpoint_auth_methods_supported)
      || !body.token_endpoint_auth_methods_supported.some((method) => method === 'client_secret_post' || method === 'client_secret_basic'))) {
    throw new Error('OIDC provider does not support the configured confidential-client authentication method.')
  }
  return {
    issuer,
    authorization_endpoint: authorization.href,
    token_endpoint: token.href,
    jwks_uri: jwks.href,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    ...(Array.isArray(body.token_endpoint_auth_methods_supported) ? { token_endpoint_auth_methods_supported: body.token_endpoint_auth_methods_supported.filter((item): item is string => typeof item === 'string') } : {}),
  }
}

function internalReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  try {
    const url = new URL(value, 'https://quicksilver.invalid')
    if (url.origin !== 'https://quicksilver.invalid' || url.pathname.startsWith('/api/auth/')) return '/'
    const result = `${url.pathname}${url.search}${url.hash}`
    return result.length <= 1024 ? result : '/'
  } catch { return '/' }
}

function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store', pragma: 'no-cache' })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 303, headers })
}

/**
 * Every reason sign-in can fail collapses to `/sign-in?auth=failed`, and the browser
 * is not told which one it was: naming a stage to the visitor would tell an attacker
 * whether an account exists or whether an allowlist is configured. So the stage and
 * reason go to the server log, and a short opaque `ref` goes in the URL so a person
 * can quote it and support can find the line without the reason leaking.
 *
 * This exists because the failures used to log only `error.name`, which for every
 * thrown `Error` is the literal string "Error" — seven distinct causes all logged
 * `[oidc] callback failed Error`.
 */
function signInFailure(request: Request, stage: string, reason: string, extra: Record<string, unknown> = {}): Response {
  // randomUUID rather than randomToken: this runs on paths that never reached the
  // token exchange, so it must not depend on the injected `random` the caller may
  // not have supplied, and a correlation tag needs no length contract.
  const ref = randomUUID().slice(0, 8)
  console.error('[oidc] sign-in failed', JSON.stringify({ ref, stage, reason, ...extra }))
  const target = new URL('/sign-in?auth=failed', request.url)
  target.searchParams.set('ref', ref)
  return redirect(target.href, [clearCookie(OIDC_LOGIN_COOKIE)])
}

/** The reason, never the cause object: an error message could echo a token or code. */
function reasonOf(error: unknown): string {
  return error instanceof Error && typeof error.message === 'string'
    ? error.message.replace(/[A-Za-z0-9_-]{24,}/g, '<redacted>').slice(0, 200)
    : 'UnknownError'
}

function appFailure(request: Request, stage = 'unspecified', reason = 'unspecified'): Response {
  return signInFailure(request, stage, reason)
}

function cookieValue(request: Request, name: string): string | null {
  for (const item of (request.headers.get('cookie') ?? '').split(';')) {
    const index = item.indexOf('=')
    if (index < 0 || item.slice(0, index).trim() !== name) continue
    const value = item.slice(index + 1).trim()
    return /^[A-Za-z0-9_-]{32,256}$/.test(value) ? value : null
  }
  return null
}

export async function startOidcLogin(request: Request, env: OidcBrowserEnv, deps: OidcAuthDependencies = {}): Promise<Response> {
  const config = configFrom(env)
  if (!config) {
    logNotConfigured(env)
    return appFailure(request)
  }
  const now = deps.now?.() ?? new Date()
  const random = deps.random ?? randomBytes
  const fetcher = deps.fetcher ?? fetch
  try {
    const metadata = await providerMetadata(config.issuer, fetcher)
    const state = randomToken(32, random)
    const nonce = randomToken(32, random)
    const binding = randomToken(32, random)
    const verifier = randomToken(48, random)
    const transaction = {
      stateDigest: digestAuthSecret(state),
      browserBindingDigest: digestAuthSecret(binding),
      nonce,
      codeVerifier: verifier,
      returnTo: internalReturnTo(new URL(request.url).searchParams.get('returnTo')),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LOGIN_TTL_MS).toISOString(),
    }
    await (deps.store ?? await oidcSessionStore()).createLoginTransaction(transaction)
    const authorization = new URL(metadata.authorization_endpoint)
    authorization.searchParams.set('client_id', config.clientId)
    authorization.searchParams.set('redirect_uri', config.redirectUri)
    authorization.searchParams.set('response_type', 'code')
    authorization.searchParams.set('scope', 'openid profile email')
    authorization.searchParams.set('state', state)
    authorization.searchParams.set('nonce', nonce)
    authorization.searchParams.set('code_challenge', sha256Base64Url(verifier))
    authorization.searchParams.set('code_challenge_method', 'S256')
    return redirect(authorization.href, [setCookie(OIDC_LOGIN_COOKIE, binding, LOGIN_TTL_MS / 1000)])
  } catch (error) {
    console.error('[oidc] login start failed', error instanceof Error ? error.name : 'UnknownError')
    return appFailure(request, 'login-start', reasonOf(error))
  }
}

export async function completeOidcLogin(request: Request, env: OidcBrowserEnv, deps: OidcAuthDependencies = {}): Promise<Response> {
  const config = configFrom(env)
  const url = new URL(request.url)
  const stateValues = url.searchParams.getAll('state')
  const codeValues = url.searchParams.getAll('code')
  const state = stateValues.length === 1 ? stateValues[0] : null
  const code = codeValues.length === 1 ? codeValues[0] : null
  const binding = cookieValue(request, OIDC_LOGIN_COOKIE)
  if (!config) logNotConfigured(env)
  if (!config) return signInFailure(request, 'callback-config', 'not-configured')
  if (!state) return signInFailure(request, 'callback-state', 'missing-or-duplicate')
  if (state.length > 256) return signInFailure(request, 'callback-state', 'too-long')
  if (!binding) return signInFailure(request, 'callback-binding', 'login-cookie-missing')

  const now = deps.now?.() ?? new Date()
  let store: OidcSessionStore
  let transaction
  try {
    store = deps.store ?? await oidcSessionStore()
    transaction = await store.consumeLoginTransaction(digestAuthSecret(state), digestAuthSecret(binding), now)
  } catch (error) {
    return signInFailure(request, 'callback-transaction', reasonOf(error))
  }
  if (!transaction) return signInFailure(request, 'callback-transaction', 'no-live-transaction')
  if (url.searchParams.has('error')) {
    // Google returned an error instead of a code. The code and its description are
    // safe to name (access_denied, consent_required); the state is not echoed.
    return signInFailure(request, 'callback-provider', 'provider-returned-error', {
      error: String(url.searchParams.get('error')).slice(0, 64),
      errorDescription: String(url.searchParams.get('error_description') ?? '').slice(0, 160),
    })
  }
  if (!code) return signInFailure(request, 'callback-code', 'missing-or-duplicate')
  if (code.length > 4096) return signInFailure(request, 'callback-code', 'too-long')

  const fetcher = deps.fetcher ?? fetch
  const random = deps.random ?? randomBytes
  try {
    const metadata = await providerMetadata(config.issuer, fetcher)
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: transaction.codeVerifier,
    })
    const supportsPost = !metadata.token_endpoint_auth_methods_supported
      || metadata.token_endpoint_auth_methods_supported.includes('client_secret_post')
    const tokenHeaders: Record<string, string> = { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }
    if (supportsPost) form.set('client_secret', config.clientSecret)
    else tokenHeaders.authorization = `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64')}`
    const response = await fetcher(metadata.token_endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
      headers: tokenHeaders,
      body: form,
    })
    // The status separates the two causes that matter and look identical otherwise:
    // 401 is a client id/secret that no longer matches; 400 is a spent or replayed code.
    if (!response.ok) throw new Error(`OIDC token exchange failed (HTTP ${response.status}).`)
    const tokenResult = await boundedJson(response)
    if (typeof tokenResult.id_token !== 'string') throw new Error('OIDC response did not contain an ID token.')
    const claims = await verifyOidcIdToken(tokenResult.id_token, {
      issuer: config.issuer,
      audience: config.clientId,
      jwksUri: metadata.jwks_uri,
      nonce: transaction.nonce,
    }, { fetcher, now })
    const identity = mapVerifiedOidcIdentity(claims, parseOidcIdentityBindings(env.QUICKSILVER_OIDC_USERS), env.QUICKSILVER_TENANT_ID?.trim() || 'default')
    if (!identity.ok) {
      // The ID token is verified, so name who it was: an owner adds exactly this issuer and subject to the allowlist
      // (QUICKSILVER_OIDC_USERS). Only these two values and the reason are logged, never the token or any other claim.
      console.warn('[oidc] login refused: identity is not on the allowlist', JSON.stringify({ reason: identity.reason, issuer: claims.iss, subject: claims.sub.slice(0, 512) }))
      throw new Error('OIDC identity is not mapped to an authorized tenant principal.')
    }

    const sessionToken = randomToken(32, random)
    await store.createSession({
      tokenDigest: digestAuthSecret(sessionToken),
      identity: { issuer: claims.iss, subject: claims.sub },
      principal: identity.principal,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    })
    const target = new URL(transaction.returnTo, config.redirectUri).href
    return redirect(target, [
      setCookie(OIDC_SESSION_COOKIE, sessionToken, SESSION_TTL_MS / 1000),
      clearCookie(OIDC_LOGIN_COOKIE),
    ])
  } catch (error) {
    return signInFailure(request, 'callback-exchange', reasonOf(error))
  }
}

export interface BrowserSessionPrincipal {
  id: string
  kind: 'human'
  tenantId: string
  roles: string[]
  displayName?: string
}

export async function readBrowserSession(request: Request, env: OidcBrowserEnv, deps: Pick<OidcAuthDependencies, 'store' | 'now'> = {}): Promise<BrowserSessionPrincipal | null> {
  const token = cookieValue(request, OIDC_SESSION_COOKIE)
  if (!token) return null
  const now = deps.now?.() ?? new Date()
  const session = await (deps.store ?? await oidcSessionStore()).getSession(digestAuthSecret(token), now)
  if (!session || session.revokedAt || Date.parse(session.expiresAt) <= now.getTime()) return null
  const expectedTenant = env.QUICKSILVER_TENANT_ID?.trim() || 'default'
  const identity = mapVerifiedOidcIdentity({ iss: session.identity.issuer, sub: session.identity.subject }, parseOidcIdentityBindings(env.QUICKSILVER_OIDC_USERS), expectedTenant)
  // A session minted for another tenant is refused even when the same person is mapped here under the same principal id.
  if (!identity.ok || identity.principal.kind !== 'human' || session.principal.id !== identity.principal.id || session.principal.tenantId !== expectedTenant) return null
  return {
    id: identity.principal.id,
    kind: 'human',
    tenantId: identity.principal.tenantId,
    roles: [...identity.principal.roles],
    ...(identity.principal.displayName ? { displayName: identity.principal.displayName } : {}),
  }
}

export async function revokeBrowserSession(request: Request, env: OidcBrowserEnv, deps: Pick<OidcAuthDependencies, 'store' | 'now'> = {}): Promise<boolean> {
  const token = cookieValue(request, OIDC_SESSION_COOKIE)
  if (!token) return true
  return (deps.store ?? await oidcSessionStore()).revokeSession(digestAuthSecret(token), deps.now?.() ?? new Date())
}

export function signedOutResponse(request: Request): Response {
  return redirect(new URL('/', request.url).href, [clearCookie(OIDC_SESSION_COOKIE)])
}
