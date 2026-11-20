/**
 * The six C1 query entry points (schema and repository map §7).
 *
 * The implementations live in `cms/queries.ts`; this module is the stable name
 * C1 fixtures and later routes import. `tenantId` is required and never
 * defaulted, and the read source is passed explicitly, so no caller can query
 * an implicit tenant or reach a write path.
 *
 * A foreign or missing ID returns the contract's empty result. A missing or
 * blank tenant refuses with `MalformedQuery` before anything is read.
 */
import type { DecisionHistoryFilter, QueryStore } from '../cms/queries.ts'
import {
  findContradictions as findContradictionsIn,
  getCapabilityGraph as getCapabilityGraphIn,
  getDecisionHistory as getDecisionHistoryIn,
  getEvidenceForMetric as getEvidenceForMetricIn,
  getObjectiveTree as getObjectiveTreeIn,
  getWorkflowDAG as getWorkflowDAGIn,
} from '../cms/queries.ts'
import type { TenantId } from '../cms/tenancy.ts'

export type {
  CapabilityGraph,
  ContradictionFinding,
  DecisionEvent,
  DecisionHistoryFilter,
  DecisionPage,
  MetricEvidence,
  ObjectiveNode,
  ObjectiveTree,
  QueryStore,
  WorkflowDAG,
} from '../cms/queries.ts'

export function getCapabilityGraph(store: QueryStore, tenantId: TenantId) {
  return getCapabilityGraphIn(store, tenantId)
}

export function findContradictions(store: QueryStore, tenantId: TenantId) {
  return findContradictionsIn(store, tenantId)
}

export function getWorkflowDAG(store: QueryStore, tenantId: TenantId, workflowId: string) {
  return getWorkflowDAGIn(store, tenantId, workflowId)
}

export function getObjectiveTree(store: QueryStore, tenantId: TenantId, objectiveId?: string) {
  return getObjectiveTreeIn(store, tenantId, objectiveId)
}

export function getEvidenceForMetric(
  store: QueryStore,
  tenantId: TenantId,
  metricId: string,
  page: { limit?: number } = {},
) {
  return getEvidenceForMetricIn(store, tenantId, metricId, page)
}

export function getDecisionHistory(store: QueryStore, tenantId: TenantId, filters?: DecisionHistoryFilter) {
  return getDecisionHistoryIn(store, tenantId, filters)
}
