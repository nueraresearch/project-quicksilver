/**
 * The same-tenant relation engine (schema and repository map §2.2 and §6).
 *
 * Every edge is `(tenant_id, source)` to `(tenant_id, target)`. Linking checks
 * the source exists in the tenant, then the target: same tenant is linked, a
 * target that exists only elsewhere is `CrossTenantRelation`, and a target that
 * exists nowhere is `UnresolvedRelation`. Nothing is ever rewritten to a local
 * row and nothing is silently dropped.
 *
 * Inventory scope: this list covers every §6 relation C1 enforces through a
 * link path. Append-only references (`workflowPublicationAudit` →
 * `automationWorkflow` and its peers) are written by their owning audit append
 * and are proved by Gate E; `telemetryTraceSpan` has no hard foreign key by
 * design (§6, last row).
 */
import { CrossTenantRelationError, MalformedQueryError, NotFoundError, UnresolvedRelationError } from './errors.ts'
import type { MemoryStore, StoredRow } from './store.ts'
import { requireTenant } from './tenancy.ts'

export interface RelationDefinition {
  readonly id: string
  readonly sourceTable: string
  readonly targetTable: string
  readonly kind: 'one-to-many' | 'many-to-many'
  /** Which endpoint's row carries the column, for one-to-many. */
  readonly holder?: 'source' | 'target'
  readonly column?: string
  readonly joinTable?: string
}

export const RELATION_INVENTORY: readonly RelationDefinition[] = [
  { id: 'organization.departments', sourceTable: 'qs_organizations', targetTable: 'qs_departments', kind: 'one-to-many', holder: 'target', column: 'organization_id' },
  { id: 'organization.policies', sourceTable: 'qs_organizations', targetTable: 'qs_policies', kind: 'one-to-many', holder: 'target', column: 'organization_id' },
  { id: 'organization.objectives', sourceTable: 'qs_organizations', targetTable: 'qs_objectives', kind: 'one-to-many', holder: 'target', column: 'organization_id' },
  { id: 'organization.resources', sourceTable: 'qs_organizations', targetTable: 'qs_entities', kind: 'many-to-many', joinTable: 'qs_department_members' },
  { id: 'department.parentDepartment', sourceTable: 'qs_departments', targetTable: 'qs_departments', kind: 'one-to-many', holder: 'source', column: 'parent_id' },
  { id: 'department.members', sourceTable: 'qs_departments', targetTable: 'qs_entities', kind: 'many-to-many', joinTable: 'qs_department_members' },
  { id: 'department.capabilities', sourceTable: 'qs_departments', targetTable: 'qs_capabilities', kind: 'many-to-many', joinTable: 'qs_department_capabilities' },
  { id: 'department.objectives', sourceTable: 'qs_departments', targetTable: 'qs_objectives', kind: 'one-to-many', holder: 'target', column: 'department_id' },
  { id: 'department.workflows', sourceTable: 'qs_departments', targetTable: 'qs_workflows', kind: 'one-to-many', holder: 'target', column: 'department_id' },
  { id: 'department.metrics', sourceTable: 'qs_departments', targetTable: 'qs_metrics', kind: 'one-to-many', holder: 'target', column: 'department_id' },
  { id: 'entity.department', sourceTable: 'qs_entities', targetTable: 'qs_departments', kind: 'one-to-many', holder: 'source', column: 'department_id' },
  { id: 'entity.capabilities', sourceTable: 'qs_entities', targetTable: 'qs_capabilities', kind: 'many-to-many', joinTable: 'qs_entity_capabilities' },
  { id: 'entity.policies', sourceTable: 'qs_entities', targetTable: 'qs_policies', kind: 'many-to-many', joinTable: 'qs_entity_policy_links' },
  { id: 'entity.reportsTo', sourceTable: 'qs_entities', targetTable: 'qs_entities', kind: 'one-to-many', holder: 'source', column: 'reports_to_id' },
  { id: 'capability.inherits', sourceTable: 'qs_capabilities', targetTable: 'qs_capabilities', kind: 'many-to-many', joinTable: 'qs_capability_inherits' },
  { id: 'capability.requires', sourceTable: 'qs_capabilities', targetTable: 'qs_capabilities', kind: 'many-to-many', joinTable: 'qs_capability_requires' },
  { id: 'capability.conflictsWith', sourceTable: 'qs_capabilities', targetTable: 'qs_capabilities', kind: 'many-to-many', joinTable: 'qs_capability_conflicts' },
  { id: 'capability.authorizedEntities', sourceTable: 'qs_capabilities', targetTable: 'qs_entities', kind: 'many-to-many', joinTable: 'qs_entity_capabilities' },
  { id: 'capability.policies', sourceTable: 'qs_capabilities', targetTable: 'qs_policies', kind: 'many-to-many', joinTable: 'qs_entity_policy_links' },
  { id: 'policy.organization', sourceTable: 'qs_policies', targetTable: 'qs_organizations', kind: 'one-to-many', holder: 'source', column: 'organization_id' },
  { id: 'policy.appliesTo', sourceTable: 'qs_policies', targetTable: 'qs_entities', kind: 'many-to-many', joinTable: 'qs_policy_applies_to' },
  { id: 'policy.approvalRequirements', sourceTable: 'qs_policies', targetTable: 'qs_entities', kind: 'many-to-many', joinTable: 'qs_policy_approvals' },
  { id: 'policy.supersedes', sourceTable: 'qs_policies', targetTable: 'qs_policies', kind: 'many-to-many', joinTable: 'qs_capability_inherits' },
  { id: 'objective.organization', sourceTable: 'qs_objectives', targetTable: 'qs_organizations', kind: 'one-to-many', holder: 'source', column: 'organization_id' },
  { id: 'objective.department', sourceTable: 'qs_objectives', targetTable: 'qs_departments', kind: 'one-to-many', holder: 'source', column: 'department_id' },
  { id: 'objective.owner', sourceTable: 'qs_objectives', targetTable: 'qs_entities', kind: 'one-to-many', holder: 'source', column: 'owner_id' },
  { id: 'objective.parentObjective', sourceTable: 'qs_objectives', targetTable: 'qs_objectives', kind: 'one-to-many', holder: 'source', column: 'parent_id' },
  { id: 'objective.children', sourceTable: 'qs_objectives', targetTable: 'qs_objectives', kind: 'many-to-many', joinTable: 'qs_objective_children' },
  { id: 'objective.workflows', sourceTable: 'qs_objectives', targetTable: 'qs_workflows', kind: 'one-to-many', holder: 'target', column: 'objective_id' },
  { id: 'objective.evidence', sourceTable: 'qs_objectives', targetTable: 'qs_evidence', kind: 'one-to-many', holder: 'target', column: 'objective_id' },
  { id: 'objective.decisions', sourceTable: 'qs_objectives', targetTable: 'qs_decisions', kind: 'one-to-many', holder: 'target', column: 'objective_id' },
  { id: 'objective.metrics', sourceTable: 'qs_objectives', targetTable: 'qs_metrics', kind: 'one-to-many', holder: 'target', column: 'objective_id' },
  { id: 'workflow.department', sourceTable: 'qs_workflows', targetTable: 'qs_departments', kind: 'one-to-many', holder: 'source', column: 'department_id' },
  { id: 'workflow.objective', sourceTable: 'qs_workflows', targetTable: 'qs_objectives', kind: 'one-to-many', holder: 'source', column: 'objective_id' },
  { id: 'workflow.requiredCapabilities', sourceTable: 'qs_workflows', targetTable: 'qs_capabilities', kind: 'many-to-many', joinTable: 'qs_workflow_required_capabilities' },
  { id: 'workflow.decisions', sourceTable: 'qs_workflows', targetTable: 'qs_decisions', kind: 'one-to-many', holder: 'target', column: 'workflow_id' },
  { id: 'evidence.objective', sourceTable: 'qs_evidence', targetTable: 'qs_objectives', kind: 'one-to-many', holder: 'source', column: 'objective_id' },
  { id: 'evidence.metric', sourceTable: 'qs_evidence', targetTable: 'qs_metrics', kind: 'one-to-many', holder: 'source', column: 'metric_id' },
  { id: 'evidence.relatedEntities', sourceTable: 'qs_evidence', targetTable: 'qs_entities', kind: 'many-to-many', joinTable: 'qs_evidence_related_entities' },
  { id: 'evidence.supports', sourceTable: 'qs_evidence', targetTable: 'qs_objectives', kind: 'many-to-many', joinTable: 'qs_evidence_supports' },
  { id: 'evidence.contradicts', sourceTable: 'qs_evidence', targetTable: 'qs_evidence', kind: 'many-to-many', joinTable: 'qs_capability_conflicts' },
  { id: 'decision.objective', sourceTable: 'qs_decisions', targetTable: 'qs_objectives', kind: 'one-to-many', holder: 'source', column: 'objective_id' },
  { id: 'decision.workflow', sourceTable: 'qs_decisions', targetTable: 'qs_workflows', kind: 'one-to-many', holder: 'source', column: 'workflow_id' },
  { id: 'decision.evidence', sourceTable: 'qs_decisions', targetTable: 'qs_evidence', kind: 'many-to-many', joinTable: 'qs_decision_evidence' },
  { id: 'decision.rollbackOf', sourceTable: 'qs_decisions', targetTable: 'qs_decisions', kind: 'one-to-many', holder: 'source', column: 'rollback_of_id' },
  { id: 'metric.objective', sourceTable: 'qs_metrics', targetTable: 'qs_objectives', kind: 'one-to-many', holder: 'source', column: 'objective_id' },
  { id: 'metric.relatedDecision', sourceTable: 'qs_metrics', targetTable: 'qs_decisions', kind: 'one-to-many', holder: 'source', column: 'related_decision_id' },
  { id: 'commitment.linkedDecision', sourceTable: 'qs_commitments', targetTable: 'qs_decisions', kind: 'one-to-many', holder: 'source', column: 'linked_decision_id' },
  { id: 'scheduledItem.linkedCommitment', sourceTable: 'qs_scheduled_items', targetTable: 'qs_commitments', kind: 'one-to-many', holder: 'source', column: 'linked_commitment_id' },
  { id: 'scheduledItem.linkedDecision', sourceTable: 'qs_scheduled_items', targetTable: 'qs_decisions', kind: 'one-to-many', holder: 'source', column: 'linked_decision_id' },
  { id: 'scheduledItem.linkedContact', sourceTable: 'qs_scheduled_items', targetTable: 'qs_contacts', kind: 'one-to-many', holder: 'source', column: 'linked_contact_id' },
  { id: 'draftedCommunication.contact', sourceTable: 'qs_drafted_communications', targetTable: 'qs_contacts', kind: 'one-to-many', holder: 'source', column: 'contact_id' },
  { id: 'draftedCommunication.commitment', sourceTable: 'qs_drafted_communications', targetTable: 'qs_commitments', kind: 'one-to-many', holder: 'source', column: 'linked_commitment_id' },
  { id: 'draftedCommunication.decision', sourceTable: 'qs_drafted_communications', targetTable: 'qs_decisions', kind: 'one-to-many', holder: 'source', column: 'linked_decision_id' },
]

export function relationById(id: string): RelationDefinition {
  const relation = RELATION_INVENTORY.find((candidate) => candidate.id === id)
  if (!relation) throw new MalformedQueryError(`unknown relation: ${id}`)
  return relation
}

export interface LinkOptions {
  actorId: string
}

/**
 * Links one edge, refusing a foreign or missing target before any write.
 * Returns the relation so a caller (and a test) can see what was enforced.
 */
export function linkRelation(
  store: MemoryStore,
  tenantId: string,
  relation: RelationDefinition,
  sourceId: string,
  targetId: string,
  options: LinkOptions,
): RelationDefinition {
  const tenant = requireTenant(tenantId)
  if (!options || typeof options.actorId !== 'string' || !options.actorId.trim()) {
    throw new MalformedQueryError('actorId is required')
  }
  if (typeof sourceId !== 'string' || !sourceId.trim()) throw new MalformedQueryError('sourceId is required')
  if (typeof targetId !== 'string' || !targetId.trim()) throw new MalformedQueryError('targetId is required')

  const source = store.findById(relation.sourceTable, tenant, sourceId)
  if (!source) throw new NotFoundError()
  const target = store.findById(relation.targetTable, tenant, targetId)
  if (!target) {
    if (store.existsInAnotherTenant(relation.targetTable, tenant, targetId)) throw new CrossTenantRelationError()
    throw new UnresolvedRelationError()
  }

  if (relation.kind === 'many-to-many') {
    const joinTable = relation.joinTable!
    const existing = store
      .rows(joinTable)
      .find((row) => row.tenant_id === tenant && row.from_id === sourceId && row.to_id === targetId)
    if (!existing) {
      store.insert(joinTable, {
        tenant_id: tenant,
        id: store.ids.next('lnk'),
        from_id: sourceId,
        to_id: targetId,
        created_at: store.clock.now(),
        created_by: options.actorId,
      })
    }
    return relation
  }

  const column = relation.column!
  if (relation.holder === 'target') {
    store.replace(relation.targetTable, tenant, targetId, { [column]: sourceId })
  } else {
    store.replace(relation.sourceTable, tenant, sourceId, { [column]: targetId })
  }
  return relation
}

/** Rows of a join table for one tenant, used by the relation tests. */
export function joinRows(store: MemoryStore, tenantId: string, joinTable: string): StoredRow[] {
  return store.rows(joinTable).filter((row) => row.tenant_id === tenantId)
}
