/**
 * The six C1 query contracts (schema and repository map §5.3, Gate G).
 *
 * Every one takes `tenantId` first and refuses a missing or blank one with
 * `MalformedQuery` — that is A03's subject, and it must hold before Gate G is
 * implemented because the refusal is the tenancy guarantee, not a query result.
 *
 * The bodies arrive with Stage 7. Until then each refuses with
 * `StageNotImplementedError` instead of returning an empty list: an empty graph
 * or an empty contradiction list from an unwired query would read as "there is
 * nothing", which is a silent false claim about a tenant's data.
 */
import { StageNotImplementedError } from './errors.ts'
import { requireTenant, type Page, type TenantId } from './repositories.ts'

export interface CapabilityGraph {
  nodes: string[]
  edges: Array<{ from: string; to: string; kind: string }>
}

export interface Contradiction {
  kind: string
  id: string
  provenance: string[]
}

export interface WorkflowDAG {
  graphId: string
  version: number
  digest: string
  nodes: Array<{ id: string; kind: string }>
  edges: Array<{ from: string; to: string }>
}

export interface ObjectiveTreeNode {
  id: string
  name: string
  children: ObjectiveTreeNode[]
  truncated?: boolean
}

export interface EvidenceRow {
  id: string
  metricId: string
  observedAt: string | null
}

export interface DecisionEvent {
  eventId: string
  seq: number
  at: string
  event: string
}

function unimplemented(contract: string): never {
  throw new StageNotImplementedError(`${contract} is planned for C1 Stage 7 and is not implemented in Stage 1`)
}

export async function getCapabilityGraph(tenantId: TenantId): Promise<CapabilityGraph> {
  requireTenant(tenantId)
  return unimplemented('getCapabilityGraph')
}

export async function findContradictions(tenantId: TenantId): Promise<Contradiction[]> {
  requireTenant(tenantId)
  return unimplemented('findContradictions')
}

export async function getWorkflowDAG(tenantId: TenantId, graphId: string): Promise<WorkflowDAG | null> {
  requireTenant(tenantId)
  if (typeof graphId !== 'string' || !graphId.trim()) return null
  return unimplemented('getWorkflowDAG')
}

export async function getObjectiveTree(tenantId: TenantId, rootId?: string): Promise<ObjectiveTreeNode | null> {
  requireTenant(tenantId)
  return unimplemented(`getObjectiveTree${rootId ? `(${rootId})` : ''}`)
}

export async function getEvidenceForMetric(
  tenantId: TenantId,
  metricId: string,
  page: { limit: number },
): Promise<Page<EvidenceRow>> {
  requireTenant(tenantId)
  void metricId
  void page
  return unimplemented('getEvidenceForMetric')
}

export async function getDecisionHistory(
  tenantId: TenantId,
  filters: { status?: string; kind?: string; cursor?: string; limit: number },
): Promise<Page<DecisionEvent>> {
  requireTenant(tenantId)
  void filters
  return unimplemented('getDecisionHistory')
}

/** The contracts Gate G enumerates; G07 requires all six to be present. */
export const C1_QUERY_CONTRACTS = [
  getCapabilityGraph,
  findContradictions,
  getWorkflowDAG,
  getObjectiveTree,
  getEvidenceForMetric,
  getDecisionHistory,
] as const
