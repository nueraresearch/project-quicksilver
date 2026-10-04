/** Pure helpers for scripts/demo-seed-decisions.ts: where it may point, and what it reports. */

/** The script sends public demo tokens, so it only talks to https sites or this machine. */
export function assertSafeBaseUrl(raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('--base-url must be a full URL, for example https://demo.example.com') }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('--base-url must be https (http is allowed only for localhost).')
  if (url.username || url.password) throw new Error('--base-url must not contain credentials.')
  if (url.search || url.hash) throw new Error('--base-url must not have a query string or fragment.')
  return url
}

export interface PlannedDecision {
  decisionDocId: string
  action: string
  safetyDecision: string | null
  status: string | null
}

/** The decisions a /api/plan response saved, ignoring candidate actions that were not saved. */
export function plannedDecisions(body: unknown): PlannedDecision[] {
  const decisions = (body as { decisions?: unknown } | null)?.decisions
  if (!Array.isArray(decisions)) return []
  return decisions.flatMap((item): PlannedDecision[] => {
    const row = item as { decisionDocId?: unknown; status?: unknown; safetyDecision?: unknown; action?: { description?: unknown } }
    if (typeof row.decisionDocId !== 'string' || !row.decisionDocId) return []
    return [{
      decisionDocId: row.decisionDocId,
      action: typeof row.action?.description === 'string' ? row.action.description : '(no description)',
      safetyDecision: typeof row.safetyDecision === 'string' ? row.safetyDecision : null,
      status: typeof row.status === 'string' ? row.status : null,
    }]
  })
}

export const isWaitingForApproval = (d: PlannedDecision): boolean => d.status === 'awaiting-approval' || d.status === 'proposed'

/**
 * Who the seeding script asks as. With `--token-env NAME` it is the entity whose token sits in that
 * environment variable (for example an agent on a production site); the token is never printed. Without
 * it, the public demo requester, which only a demo-mode deployment accepts.
 */
export function requesterFor(
  tokenEnv: string | undefined,
  env: Record<string, string | undefined>,
  demo: { displayName: string; token: string },
): { label: string; token: string } {
  if (tokenEnv === undefined) return { label: demo.displayName, token: demo.token }
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(tokenEnv)) throw new Error('--token-env must be an environment variable name such as QUICKSILVER_AGENT_TOKEN.')
  const token = env[tokenEnv]?.trim()
  if (!token) throw new Error(`The environment variable ${tokenEnv} is not set. Set it in your own shell; do not paste the token anywhere else.`)
  if (token.length < 32 || token.length > 512 || /\s/.test(token)) throw new Error(`${tokenEnv} does not look like an access token (it should be one string of at least 32 characters).`)
  return { label: `the entity behind ${tokenEnv}`, token }
}
