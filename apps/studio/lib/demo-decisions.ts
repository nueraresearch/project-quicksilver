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
