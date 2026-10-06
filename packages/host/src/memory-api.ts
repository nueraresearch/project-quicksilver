import type { MemoryKind, MemoryStore } from '@quicksilver/kernel'
import type { Principal } from '@quicksilver/kernel/identity'

export interface MemoryApiDeps {
  store: MemoryStore
  /** Must check the host's tenant decision journal, not trust a caller-supplied reference. */
  decisionExists: (id: string) => Promise<boolean>
  now?: () => number
}

export interface MemoryApiContext {
  method: string
  parts: string[]
  query?: URLSearchParams
  principal: Principal
  readBody: () => Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }>
}

type Response = { status: number; body: unknown }
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const KINDS = new Set<MemoryKind>(['failure-exemplar', 'routing-rule', 'safety-constraint', 'domain-pattern', 'agent-profile', 'model-profile'])

/** Authenticated tenant memory management; every write still passes through MemoryStore's governor. */
export async function handleMemoryRoute(ctx: MemoryApiContext, deps: MemoryApiDeps): Promise<Response | undefined> {
  const { method, parts, principal } = ctx
  if (parts[1] !== 'memory') return undefined
  const now = deps.now?.() ?? Date.now()

  if (parts.length === 2 && method === 'GET') {
    const kindValue = ctx.query?.get('kind') ?? undefined
    if (kindValue && !KINDS.has(kindValue as MemoryKind)) return { status: 400, body: { error: 'Unknown memory kind.' } }
    const domain = ctx.query?.get('domain') ?? undefined
    if (domain !== undefined && !DOMAIN.test(domain)) return { status: 400, body: { error: 'Invalid memory domain.' } }
    const limit = Math.min(200, Math.max(1, Number(ctx.query?.get('limit') ?? 50) || 50))
    const memories = deps.store.entries()
      .filter((entry) => Date.parse(entry.expiresAt) > now)
      .filter((entry) => !domain || entry.domain === domain)
      .filter((entry) => !kindValue || entry.kind === kindValue)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(({ id, kind, domain: entryDomain, content, source, confidence, retentionDays, proposedBy, approvalId, createdAt, expiresAt }) => ({
        id, kind, domain: entryDomain, content, source, confidence, retentionDays, proposedBy,
        ...(approvalId ? { approvalId } : {}), createdAt, expiresAt,
      }))
    return { status: 200, body: { memories, count: memories.length } }
  }

  if (parts.length === 2 && method === 'POST') {
    if (principal.kind !== 'human') return { status: 403, body: { error: 'Only a human may add governed memory.' } }
    const body = await ctx.readBody()
    if (!body.ok) return { status: body.status, body: { error: body.error } }
    const input = (body.value ?? {}) as Record<string, unknown>
    if (typeof input.id !== 'string' || !ID.test(input.id)) return { status: 400, body: { error: 'id must be a valid memory identifier.' } }
    if (typeof input.kind !== 'string' || !KINDS.has(input.kind as MemoryKind)) return { status: 400, body: { error: 'Unknown memory kind.' } }
    if (typeof input.domain !== 'string' || !DOMAIN.test(input.domain)) return { status: 400, body: { error: 'domain must be a valid memory domain.' } }
    if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 10_000) return { status: 400, body: { error: 'content must contain 1–10,000 characters.' } }
    if (typeof input.sourceDecisionId !== 'string' || !input.sourceDecisionId.trim() || input.sourceDecisionId.length > 200) {
      return { status: 400, body: { error: 'sourceDecisionId must name an existing decision.' } }
    }
    if (!await deps.decisionExists(input.sourceDecisionId)) return { status: 422, body: { error: 'The source decision does not exist in this tenant.' } }
    const confidence = input.confidence === undefined ? 0.8 : input.confidence
    const retentionDays = input.retentionDays === undefined ? 365 : input.retentionDays
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { status: 400, body: { error: 'confidence must be between 0 and 1.' } }
    if (typeof retentionDays !== 'number' || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3_650) return { status: 400, body: { error: 'retentionDays must be an integer from 1 to 3,650.' } }

    const result = deps.store.write({
      id: input.id,
      // Caller-supplied approvalId is ignored. The store records a governed
      // refusal for behavior-changing kinds rather than bypassing its audit trail.
      kind: input.kind as MemoryKind,
      domain: input.domain,
      content: input.content,
      source: `decision:${input.sourceDecisionId}`,
      confidence,
      retentionDays,
    }, { proposedBy: { id: principal.id, kind: 'human' }, now })
    if (!result.stored && !result.unchanged) {
      const conflict = result.decision.reasons.some((reason) => reason.includes('already exists with different content'))
      return { status: conflict ? 409 : 422, body: { error: 'Memory was refused by the governor.', reasons: result.decision.reasons } }
    }
    return { status: result.unchanged ? 200 : 201, body: { id: input.id, stored: result.stored, unchanged: result.unchanged } }
  }

  if (parts.length === 4 && parts[3] === 'forget' && method === 'POST') {
    if (principal.kind !== 'human') return { status: 403, body: { error: 'Only a human may forget memory.' } }
    let id: string
    try { id = decodeURIComponent(parts[2] ?? '') } catch { return { status: 400, body: { error: 'Invalid memory identifier.' } } }
    if (!ID.test(id)) return { status: 400, body: { error: 'Invalid memory identifier.' } }
    const forgotten = deps.store.forget(id, { id: principal.id, kind: 'human' }, now)
    return forgotten ? { status: 200, body: { id, forgotten: true } } : { status: 404, body: { error: 'Memory not found.' } }
  }

  return undefined
}
