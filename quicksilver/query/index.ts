import type { TenantId, TenantScopedRecord } from '../utils/types.ts'

export type QuicksilverQueryResult<T extends TenantScopedRecord = TenantScopedRecord> = Promise<T[]>

// TODO: implement tenant-scoped graph traversal through the Strapi repository adapter.
export function getCapabilityGraph(_tenantId: TenantId): QuicksilverQueryResult {
  throw new Error('TODO: getCapabilityGraph is not implemented.')
}

// TODO: compare applicable policies and evidence without crossing tenant boundaries.
export function findContradictions(_tenantId: TenantId): QuicksilverQueryResult {
  throw new Error('TODO: findContradictions is not implemented.')
}

// TODO: return the validated directed acyclic graph for a tenant workflow.
export function getWorkflowDAG(_tenantId: TenantId, _workflowId: string): QuicksilverQueryResult {
  throw new Error('TODO: getWorkflowDAG is not implemented.')
}

// TODO: return the parent/child objective hierarchy for one tenant.
export function getObjectiveTree(_tenantId: TenantId, _objectiveId?: string): QuicksilverQueryResult {
  throw new Error('TODO: getObjectiveTree is not implemented.')
}

// TODO: resolve evidence linked to a metric, filtered to the same tenant.
export function getEvidenceForMetric(_tenantId: TenantId, _metricId: string): QuicksilverQueryResult {
  throw new Error('TODO: getEvidenceForMetric is not implemented.')
}

// TODO: return immutable, tenant-scoped decision history in deterministic order.
export function getDecisionHistory(_tenantId: TenantId, _filters?: Record<string, unknown>): QuicksilverQueryResult {
  throw new Error('TODO: getDecisionHistory is not implemented.')
}
