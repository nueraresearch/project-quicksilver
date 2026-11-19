/**
 * The six C1 query contracts (schema and repository map §7).
 *
 * Each takes `tenantId` first and refuses a missing or blank one with
 * `MalformedQuery` before reading anything. A foreign or missing ID returns the
 * contract's empty result — never another tenant's row, and never a widened
 * result. Queries never write.
 *
 * Implemented here: the structural parts B10 exercises (tenant scope, foreign
 * IDs, deterministic ordering, bounds). The refinements Gate G adds later —
 * cycle/dangling refusal in the capability graph, policy-conflict and
 * metric-drift contradiction kinds, and DAG validation against the kernel — are
 * marked where they belong rather than claimed.
 */
import {
  MalformedQueryError,
  UnresolvedRelationError,
} from './errors.ts'
import { requireTenant, type TenantId } from './tenancy.ts'
import type { MemoryStore, StoredRow } from './store.ts'

export interface CapabilityGraph {
  nodes: Array<{ id: string; name: string; riskLevel: number; policyScopes: string[] }>
  edges: Array<{ from: string; to: string; kind: 'inherits' | 'requires' | 'conflictsWith' }>
  truncated: boolean
}

export interface ContradictionFinding {
  id: string
  kind: 'policy-conflict' | 'evidence-contradiction' | 'metric-drift'
  subjectIds: string[]
  evidenceIds?: string[]
  severity: 'low' | 'medium' | 'high'
  reason: string
}

export interface WorkflowDAG {
  graphId: string
  version: number
  digest: string
  entryNodeId: string
  nodes: Array<{ id: string; kind: string; label: string; config: unknown }>
  edges: Array<{ id: string; from: string; to: string; branch?: 'true' | 'false' }>
  truncated: boolean
}

export interface ObjectiveNode {
  id: string
  name: string
  parentId: string | null
  ownerId: string | null
  departmentId: string | null
  status: string
  childIds: string[]
}

export interface ObjectiveTree {
  roots: ObjectiveNode[]
  truncated: boolean
}

export interface MetricEvidence {
  id: string
  title: string
  type: string
  source: string | null
  claim: string | null
  confidence: number | null
  observedAt: string | null
  effectiveDate: string | null
  digest: string
}

export interface DecisionEvent {
  decisionId: string
  seq: number
  eventId: string
  eventType: string
  fromStatus: string | null
  toStatus: string
  actorId: string
  at: string
  actionFingerprint: string | null
  policySnapshotVersion: string | null
  payloadDigest: string
  prevHash: string | null
  hash: string
}

export interface DecisionHistoryFilter {
  decisionId?: string
  status?: string[]
  kind?: 'plan' | 'rollback'
  objectiveId?: string
  workflowId?: string
  actorId?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
  order?: 'asc' | 'desc'
}

export interface DecisionPage {
  events: DecisionEvent[]
  nextCursor: string | null
  truncated: boolean
}

const GRAPH_NODES = 500
const GRAPH_EDGES = 2000
const CONTRADICTIONS = 200
const TREE_DEPTH = 32
const TREE_NODES = 1000
const EVIDENCE_DEFAULT = 100
const EVIDENCE_MAX = 500

const visible = (row: StoredRow): boolean => row.lifecycle === 'published' && typeof row.deleted_at !== 'string'

function tenantRows(store: MemoryStore, table: string, tenantId: TenantId): StoredRow[] {
  return store.rows(table).filter((row) => row.tenant_id === tenantId)
}

/** §7.1 — published capabilities only, edges resolved inside the tenant. */
export async function getCapabilityGraph(store: MemoryStore, tenantId: TenantId): Promise<CapabilityGraph> {
  const tenant = requireTenant(tenantId)
  const capabilities = tenantRows(store, 'qs_capabilities', tenant).filter(visible)
  const byId = new Map(capabilities.map((row) => [String(row.id), row]))

  const edges: CapabilityGraph['edges'] = []
  for (const [id, row] of byId) {
    for (const [kind, field] of [
      ['inherits', 'inherits_ids'],
      ['requires', 'requires_ids'],
      ['conflictsWith', 'conflicts_with_ids'],
    ] as const) {
      for (const target of (row[field] as string[] | undefined) ?? []) {
        if (!byId.has(target)) {
          // A dangling or foreign edge is a graph-integrity failure, not an omitted edge.
          throw new UnresolvedRelationError(`capability ${id} has a ${kind} edge to ${target} that does not resolve`)
        }
        edges.push({ from: id, to: target, kind })
      }
    }
  }

  edges.sort((left, right) => `${left.from}\u0000${left.to}\u0000${left.kind}`.localeCompare(`${right.from}\u0000${right.to}\u0000${right.kind}`))
  const nodes = [...byId.values()]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .slice(0, GRAPH_NODES)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      riskLevel: Number(row.risk_level ?? 0),
      policyScopes: (row.policy_scopes as string[] | undefined) ?? [],
    }))

  return {
    nodes,
    edges: edges.slice(0, GRAPH_EDGES),
    truncated: byId.size > GRAPH_NODES || edges.length > GRAPH_EDGES,
  }
}

/** §7.2 — evidence contradictions now; policy and metric kinds arrive with G02. */
export async function findContradictions(store: MemoryStore, tenantId: TenantId): Promise<ContradictionFinding[]> {
  const tenant = requireTenant(tenantId)
  const evidence = tenantRows(store, 'qs_evidence', tenant).filter((row) => typeof row.deleted_at !== 'string')
  const ids = new Set(evidence.map((row) => String(row.id)))
  const findings: ContradictionFinding[] = []

  for (const row of evidence) {
    for (const target of (row.contradicts_ids as string[] | undefined) ?? []) {
      if (!ids.has(target)) throw new UnresolvedRelationError(`evidence ${row.id} contradicts ${target} that does not resolve`)
      findings.push({
        id: `evidence:${row.id}:${target}`,
        kind: 'evidence-contradiction',
        subjectIds: [String(row.id), target],
        evidenceIds: [String(row.id), target],
        severity: 'medium',
        reason: 'one evidence record contradicts another inside the same tenant',
      })
    }
  }

  findings.sort((left, right) => `${left.kind}\u0000${left.id}`.localeCompare(`${right.kind}\u0000${right.id}`))
  return findings.slice(0, CONTRADICTIONS)
}

/**
 * §7.3 — the active publication head resolves one exact same-tenant version.
 * A missing head/version, or a foreign graph id, returns null: no draft fallback.
 */
export async function getWorkflowDAG(store: MemoryStore, tenantId: TenantId, graphId: string): Promise<WorkflowDAG | null> {
  const tenant = requireTenant(tenantId)
  if (typeof graphId !== 'string' || !graphId.trim()) throw new MalformedQueryError('graphId is required')

  const head = tenantRows(store, 'qs_workflow_publication_heads', tenant).find((row) => row.graph_id === graphId)
  if (!head) return null
  const version = tenantRows(store, 'qs_automation_workflows', tenant).find(
    (row) => row.graph_id === graphId && row.version === head.active_version,
  )
  if (!version) return null

  const nodes = ((version.nodes as WorkflowDAG['nodes'] | undefined) ?? []).slice().sort((left, right) => left.id.localeCompare(right.id))
  const edges = ((version.edges as WorkflowDAG['edges'] | undefined) ?? []).slice().sort((left, right) => left.id.localeCompare(right.id))
  return {
    graphId,
    version: Number(version.version),
    digest: String(version.digest ?? ''),
    entryNodeId: String(version.entry_node_id ?? ''),
    nodes,
    edges,
    truncated: false,
  }
}

/** §7.4 — one subtree or the roots; a foreign root yields an empty tree. */
export async function getObjectiveTree(store: MemoryStore, tenantId: TenantId, objectiveId?: string): Promise<ObjectiveTree> {
  const tenant = requireTenant(tenantId)
  const objectives = tenantRows(store, 'qs_objectives', tenant).filter(visible)
  const byId = new Map(objectives.map((row) => [String(row.id), row]))

  if (objectiveId !== undefined) {
    if (!byId.has(objectiveId)) return { roots: [], truncated: false }
    const selected = new Set<string>([objectiveId])
    const stack = [objectiveId]
    while (stack.length) {
      const current = stack.pop()!
      for (const childId of (byId.get(current)?.child_ids as string[] | undefined) ?? []) {
        if (selected.has(childId)) continue
        if (!byId.has(childId)) throw new UnresolvedRelationError(`objective ${current} has a child ${childId} that does not resolve`)
        selected.add(childId)
        stack.push(childId)
      }
    }
    const roots = [...selected].filter((id) => id === objectiveId || byId.get(id)?.parent_id !== objectiveId)
    const built = buildTree(roots, byId)
    return { roots: built.roots, truncated: built.truncated }
  }

  const roots = objectives
    .filter((row) => row.parent_id === null || row.parent_id === undefined || !byId.has(String(row.parent_id)))
    .map((row) => String(row.id))
  return buildTree(roots, byId)
}

function buildTree(rootIds: string[], byId: Map<string, StoredRow>): ObjectiveTree {
  let nodes = 0
  let truncated = false
  const order = (ids: string[]) => ids.sort((left, right) => {
    const a = byId.get(left)!
    const b = byId.get(right)!
    return String(a.name ?? '').localeCompare(String(b.name ?? '')) || left.localeCompare(right)
  })

  const visit = (id: string, depth: number): ObjectiveNode | null => {
    if (nodes >= TREE_NODES || depth > TREE_DEPTH) {
      truncated = true
      return null
    }
    nodes += 1
    const row = byId.get(id)!
    const childIds = order(((row.child_ids as string[] | undefined) ?? []).filter((childId) => byId.has(childId)))
    return {
      id,
      name: String(row.name ?? ''),
      parentId: (row.parent_id as string | null | undefined) ?? null,
      ownerId: (row.owner_id as string | null | undefined) ?? null,
      departmentId: (row.department_id as string | null | undefined) ?? null,
      status: String(row.status ?? ''),
      childIds: childIds.filter((childId) => visit(childId, depth + 1) !== null || truncated),
    }
  }

  const roots = order([...rootIds])
    .map((id) => visit(id, 0))
    .filter((node): node is ObjectiveNode => node !== null)
  return { roots, truncated }
}

/** §7.5 — direct evidence links only, newest first, bounded. */
export async function getEvidenceForMetric(
  store: MemoryStore,
  tenantId: TenantId,
  metricId: string,
  page: { limit?: number } = {},
): Promise<MetricEvidence[]> {
  const tenant = requireTenant(tenantId)
  if (typeof metricId !== 'string' || !metricId.trim()) throw new MalformedQueryError('metricId is required')
  const limit = page.limit ?? EVIDENCE_DEFAULT
  if (!Number.isInteger(limit) || limit < 1 || limit > EVIDENCE_MAX) {
    throw new MalformedQueryError(`limit must be an integer between 1 and ${EVIDENCE_MAX}`)
  }
  if (!store.findById('qs_metrics', tenant, metricId)) return []

  return tenantRows(store, 'qs_evidence', tenant)
    .filter((row) => row.metric_id === metricId && typeof row.deleted_at !== 'string')
    .sort((left, right) => {
      const a = left.observed_at ? String(left.observed_at) : null
      const b = right.observed_at ? String(right.observed_at) : null
      if (a === null && b !== null) return 1
      if (a !== null && b === null) return -1
      if (a !== b) return String(b).localeCompare(String(a))
      return String(left.id).localeCompare(String(right.id))
    })
    .slice(0, limit)
    .map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ''),
      type: String(row.type ?? ''),
      source: (row.source as string | null | undefined) ?? null,
      claim: (row.claim as string | null | undefined) ?? null,
      confidence: typeof row.confidence === 'number' ? row.confidence : null,
      observedAt: (row.observed_at as string | null | undefined) ?? null,
      effectiveDate: (row.effective_date as string | null | undefined) ?? null,
      digest: String(row.digest ?? ''),
    }))
}

/** §7.6 — immutable events, stable ordering, tenant-bound opaque cursor. */
export async function getDecisionHistory(
  store: MemoryStore,
  tenantId: TenantId,
  filters: DecisionHistoryFilter = {},
): Promise<DecisionPage> {
  const tenant = requireTenant(tenantId)
  const limit = filters.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new MalformedQueryError('limit must be between 1 and 100')
  if (filters.kind !== undefined && filters.kind !== 'plan' && filters.kind !== 'rollback') {
    throw new MalformedQueryError('kind must be plan or rollback')
  }
  if (filters.status !== undefined && !Array.isArray(filters.status)) throw new MalformedQueryError('status must be an array')
  const from = filters.from === undefined ? null : Date.parse(filters.from)
  const to = filters.to === undefined ? null : Date.parse(filters.to)
  if (from !== null && Number.isNaN(from)) throw new MalformedQueryError('from must be an ISO timestamp')
  if (to !== null && Number.isNaN(to)) throw new MalformedQueryError('to must be an ISO timestamp')

  const decisions = new Map(tenantRows(store, 'qs_decisions', tenant).map((row) => [String(row.id), row]))
  let events = tenantRows(store, 'qs_decision_events', tenant).filter((row) => {
    const decision = decisions.get(String(row.decision_id))
    if (filters.decisionId !== undefined && row.decision_id !== filters.decisionId) return false
    if (!decision) return false
    if (filters.kind !== undefined && decision.kind !== filters.kind) return false
    if (filters.objectiveId !== undefined && decision.objective_id !== filters.objectiveId) return false
    if (filters.workflowId !== undefined && decision.workflow_id !== filters.workflowId) return false
    if (filters.actorId !== undefined && row.actor_id !== filters.actorId) return false
    if (filters.status !== undefined && !filters.status.includes(String(row.to_status))) return false
    const at = Date.parse(String(row.at))
    if (from !== null && at < from) return false
    if (to !== null && at >= to) return false
    return true
  })

  if (filters.decisionId !== undefined && !decisions.has(filters.decisionId)) events = []

  const ascending = filters.order === 'asc'
  const key = (row: StoredRow) => `${String(row.at)}\u0000${String(row.seq).padStart(12, '0')}\u0000${String(row.event_id)}`
  events = events.slice().sort((left, right) => (ascending ? 1 : -1) * key(left).localeCompare(key(right)))

  if (filters.cursor !== undefined) {
    let after: { tenant?: unknown; at?: unknown; seq?: unknown; eventId?: unknown }
    try {
      after = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString('utf8'))
    } catch {
      throw new MalformedQueryError('cursor is malformed')
    }
    if (after.tenant !== tenant) throw new MalformedQueryError('cursor does not belong to this tenant')
    const marker = `${String(after.at)}\u0000${String(after.seq).padStart(12, '0')}\u0000${String(after.eventId)}`
    events = events.filter((row) => (ascending ? key(row) > marker : key(row) < marker))
  }

  const page = events.slice(0, limit)
  const last = page.at(-1)
  return {
    events: page.map((row) => ({
      decisionId: String(row.decision_id),
      seq: Number(row.seq),
      eventId: String(row.event_id),
      eventType: String(row.event_type),
      fromStatus: (row.from_status as string | null | undefined) ?? null,
      toStatus: String(row.to_status),
      actorId: String(row.actor_id),
      at: String(row.at),
      actionFingerprint: (row.action_fingerprint as string | null | undefined) ?? null,
      policySnapshotVersion: (row.policy_snapshot_version as string | null | undefined) ?? null,
      payloadDigest: String(row.payload_digest ?? ''),
      prevHash: (row.prev_hash as string | null | undefined) ?? null,
      hash: String(row.hash ?? ''),
    })),
    nextCursor:
      page.length === limit && last
        ? Buffer.from(JSON.stringify({ tenant, at: last.at, seq: last.seq, eventId: last.event_id })).toString('base64url')
        : null,
    truncated: events.length > limit,
  }
}
