/**
 * The C1 store catalog (schema and repository map §3 and §4).
 *
 * 21 native collections and 13 derived/audit stores, excluding the two OIDC
 * adapters. A01 asserts these exact counts, so this file is the schema freeze
 * the bootstrap test reads: adding or removing a store here moves A01.
 */
export type StoreKind = 'collection' | 'derived'

export interface StoreDefinition {
  /** Persistence name; also the table name in the selected adapter. */
  readonly name: string
  readonly kind: StoreKind
  /** The Sanity `_type` this store was derived from, or `implementation`. */
  readonly sourceType: string
  /** Business key after the tenant column. `['id']` means tenant + opaque id. */
  readonly key: readonly string[]
  readonly repository: string
}

export const C1_COLLECTIONS: readonly StoreDefinition[] = [
  { name: 'qs_organizations', kind: 'collection', sourceType: 'organization', key: ['id'], repository: 'OrganizationRepository' },
  { name: 'qs_departments', kind: 'collection', sourceType: 'department', key: ['id'], repository: 'DepartmentRepository' },
  { name: 'qs_entities', kind: 'collection', sourceType: 'entity', key: ['id'], repository: 'EntityRepository' },
  { name: 'qs_capabilities', kind: 'collection', sourceType: 'capability', key: ['id'], repository: 'CapabilityRepository' },
  { name: 'qs_policies', kind: 'collection', sourceType: 'policy', key: ['id'], repository: 'PolicyRepository' },
  { name: 'qs_objectives', kind: 'collection', sourceType: 'objective', key: ['id'], repository: 'ObjectiveRepository' },
  { name: 'qs_workflows', kind: 'collection', sourceType: 'workflow', key: ['id'], repository: 'ProcessDefinitionRepository' },
  { name: 'qs_automation_workflows', kind: 'collection', sourceType: 'automationWorkflow', key: ['graph_id', 'version'], repository: 'AutomationWorkflowRepository' },
  { name: 'qs_workflow_publication_heads', kind: 'collection', sourceType: 'workflowPublicationHead', key: ['graph_id'], repository: 'WorkflowPublicationHeadRepository' },
  { name: 'qs_evidence', kind: 'collection', sourceType: 'evidence', key: ['id'], repository: 'EvidenceRepository' },
  { name: 'qs_decisions', kind: 'collection', sourceType: 'decision', key: ['id'], repository: 'DecisionRepository' },
  { name: 'qs_metrics', kind: 'collection', sourceType: 'metric', key: ['id'], repository: 'MetricRepository' },
  { name: 'qs_intent_graphs', kind: 'collection', sourceType: 'intentGraph', key: ['id'], repository: 'IntentGraphRepository' },
  { name: 'qs_intent_ledger_entries', kind: 'collection', sourceType: 'intentLedgerEntry', key: ['seq'], repository: 'IntentLedgerRepository' },
  { name: 'qs_agent_definitions', kind: 'collection', sourceType: 'agentDefinition', key: ['agent_id', 'version'], repository: 'AgentDefinitionRepository' },
  { name: 'qs_agent_publication_heads', kind: 'collection', sourceType: 'agentPublicationHead', key: ['agent_id'], repository: 'AgentPublicationHeadRepository' },
  { name: 'qs_commitments', kind: 'collection', sourceType: 'commitment', key: ['id'], repository: 'CommitmentRepository' },
  { name: 'qs_contacts', kind: 'collection', sourceType: 'contact', key: ['id'], repository: 'ContactRepository' },
  { name: 'qs_scheduled_items', kind: 'collection', sourceType: 'scheduledItem', key: ['id'], repository: 'ScheduledItemRepository' },
  { name: 'qs_drafted_communications', kind: 'collection', sourceType: 'draftedCommunication', key: ['id'], repository: 'DraftedCommunicationRepository' },
  { name: 'qs_playbooks', kind: 'collection', sourceType: 'playbook', key: ['playbook_id', 'version'], repository: 'PlaybookRepository' },
]

export const C1_DERIVED_STORES: readonly StoreDefinition[] = [
  { name: 'qs_department_execution_audits', kind: 'derived', sourceType: 'departmentExecutionAudit', key: ['id'], repository: 'DepartmentAuditRepository' },
  { name: 'qs_workflow_publication_audits', kind: 'derived', sourceType: 'workflowPublicationAudit', key: ['seq'], repository: 'WorkflowAuditRepository' },
  { name: 'qs_workflow_executions', kind: 'derived', sourceType: 'workflowExecution', key: ['run_id'], repository: 'WorkflowExecutionRepository' },
  { name: 'qs_evaluation_records', kind: 'derived', sourceType: 'evaluationRecord', key: ['id'], repository: 'EvaluationRepository' },
  { name: 'qs_shadow_recommendations', kind: 'derived', sourceType: 'shadowRecommendation', key: ['id'], repository: 'ShadowLogRepository' },
  { name: 'qs_aura_verdict_learners', kind: 'derived', sourceType: 'auraVerdictLearner', key: ['intent_id'], repository: 'LearnerStateRepository' },
  { name: 'qs_money_entries', kind: 'derived', sourceType: 'moneyEntry', key: ['run_id', 'seq'], repository: 'MoneyLedgerRepository' },
  { name: 'qs_experiment_records', kind: 'derived', sourceType: 'experimentRecord', key: ['run_id', 'experiment_id'], repository: 'ExperimentRepository' },
  { name: 'qs_content_reviews', kind: 'derived', sourceType: 'contentReview', key: ['id'], repository: 'ContentReviewRepository' },
  { name: 'qs_agent_publication_audits', kind: 'derived', sourceType: 'agentPublicationAudit', key: ['seq'], repository: 'AgentAuditRepository' },
  { name: 'qs_authorization_decision_audits', kind: 'derived', sourceType: 'authorizationDecisionAudit', key: ['id'], repository: 'AuthorizationAuditRepository' },
  { name: 'qs_telemetry_trace_spans', kind: 'derived', sourceType: 'telemetryTraceSpan', key: ['span_id'], repository: 'TraceRepository' },
  { name: 'qs_reviews', kind: 'derived', sourceType: 'review', key: ['id'], repository: 'OperatorReviewRepository' },
]

/**
 * Implementation support from §3.1. Registered with the catalog but never
 * counted as a collection or a derived store: A01 requires exactly 21 and 13.
 */
export const C1_INTERNAL_TABLES: readonly string[] = [
  'qs_content_revisions',
  'qs_decision_events',
  'qs_metric_observations',
  'qs_idempotency_keys',
  'qs_department_members',
  'qs_department_capabilities',
  'qs_entity_capabilities',
  'qs_entity_policy_links',
  'qs_capability_inherits',
  'qs_capability_requires',
  'qs_capability_conflicts',
  'qs_objective_children',
  'qs_workflow_required_capabilities',
  'qs_decision_evidence',
  'qs_decision_context',
  'qs_evidence_related_entities',
  'qs_evidence_supports',
  'qs_policy_applies_to',
  'qs_policy_approvals',
]

export const C1_STORES: readonly StoreDefinition[] = [...C1_COLLECTIONS, ...C1_DERIVED_STORES]

/** The two auth-plane adapters that stay out of CMS content (§4.1). */
export const EXCLUDED_AUTH_STORES: readonly string[] = ['oidcLoginTransaction', 'oidcWebSession']
