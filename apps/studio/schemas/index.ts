import organization from './organization.ts'
import department from './department.ts'
import departmentExecutionAudit from './department-execution-audit.ts'
import entity from './entity.ts'
import capability from './capability.ts'
import policy from './policy.ts'
import objective from './objective.ts'
import workflow from './workflow.ts'
import automationWorkflow from './automation-workflow.ts'
import workflowPublicationHead from './workflow-publication-head.ts'
import workflowPublicationAudit from './workflow-publication-audit.ts'
import workflowExecution from './workflow-execution.ts'
import evidence from './evidence.ts'
import decision from './decision.ts'
import metric from './metric.ts'
import evaluationRecord from './evaluation-record.ts'
import intentGraph from './intent-graph.ts'
import intentLedgerEntry from './intent-ledger-entry.ts'
import playbook from './playbook.ts'
import shadowRecommendation from './shadow-recommendation.ts'
import auraVerdictLearner from './aura-verdict-learner.ts'
import moneyEntry from './money-entry.ts'
import experimentRecord from './experiment-record.ts'
import contentReview from './content-review.ts'
import agentDefinition from './agent-definition.ts'
import agentPublicationAudit from './agent-publication-audit.ts'
import agentPublicationHead from './agent-publication-head.ts'
import authorizationDecisionAudit from './authorization-decision-audit.ts'
import telemetryTraceSpan from './telemetry-trace-span.ts'
import oidcLoginTransaction from './oidc-login-transaction.ts'
import oidcWebSession from './oidc-web-session.ts'

export const schemaTypes = [
  organization,
  department,
  departmentExecutionAudit,
  entity,
  capability,
  policy,
  objective,
  workflow,
  automationWorkflow,
  workflowPublicationHead,
  workflowPublicationAudit,
  workflowExecution,
  evidence,
  decision,
  metric,
  evaluationRecord,
  intentGraph,
  intentLedgerEntry,
  playbook,
  shadowRecommendation,
  auraVerdictLearner,
  moneyEntry,
  experimentRecord,
  contentReview,
  agentDefinition,
  agentPublicationAudit,
  agentPublicationHead,
  authorizationDecisionAudit,
  telemetryTraceSpan,
  oidcLoginTransaction,
  oidcWebSession,
]
