/**
 * The engine-off (legacy) rollback proposal behind POST /api/decisions/[id]/rollback. A decision that already
 * has a rollback waiting to be approved or run gets that rollback back instead of another copy.
 */
import type { SanityClient } from '@sanity/client'

export interface RollbackSource {
  _id: string
  selectedAction: string
  policyChecks?: unknown[]
  policySnapshotVersion?: string | null
}

export interface LegacyRollbackProposal {
  rollbackDecisionId: string
  parentDecisionId: string
  alreadyProposed: boolean
}

/** Pending rollback decisions. Rows written before `rollbackOf` existed are found by their id prefix. */
const PENDING_ROLLBACK_QUERY = `*[_type == "decision" && (rollbackOf._ref == $id || _id match $idPrefix) && status in ["proposed", "awaiting-approval", "approved"]] | order(coalesce(createdAt, _createdAt) desc)[0...1]{ _id }`

export async function proposeLegacyRollback(
  client: Pick<SanityClient, 'fetch' | 'create'>,
  original: RollbackSource,
  summary: string | undefined,
  nowMs: number,
): Promise<LegacyRollbackProposal> {
  const id = original._id
  const pending = await client.fetch<Array<{ _id: string }>>(PENDING_ROLLBACK_QUERY, { id, idPrefix: `decision-rollback-${id}-*` })
  if (pending[0]) return { rollbackDecisionId: pending[0]._id, parentDecisionId: id, alreadyProposed: true }

  // Hyphens, not dots -- Sanity treats a leading "drafts." as a special
  // document-id prefix, and mixing dots into an ordinary runtime id invites
  // confusion (or worse) with that convention. Every other generated id in
  // this codebase (decision-plan-<run>-<i>, etc.) already uses hyphens.
  const rollbackId = `decision-rollback-${id}-${nowMs}`
  await client.create({
    _id: rollbackId,
    _type: 'decision',
    rollbackOf: { _type: 'reference', _ref: id },
    question: `Roll back: ${original.selectedAction}`,
    context: [{ _type: 'reference', _ref: id, _key: id }],
    candidateActions: [],
    selectedAction: summary ?? `Roll back: ${original.selectedAction}`,
    reasoningSummary:
      'Closed-loop recovery: monitoring detected metric deviation in the wrong direction. High-confidence evidence (Historical Incident #17) suggests the underlying cause is mechanical (worn seal), not parameter drift. Rolling back the parameter change is the first corrective action.',
    evidence: [],
    constraints: [],
    policyChecks: original.policyChecks ?? [],
    policySnapshotVersion: original.policySnapshotVersion,
    riskLevel: 2,
    requiredApproval: true,
    status: 'awaiting-approval',
    createdAt: new Date(nowMs).toISOString(),
  })
  return { rollbackDecisionId: rollbackId, parentDecisionId: id, alreadyProposed: false }
}
