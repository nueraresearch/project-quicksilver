# C1 native schema and repository map (draft)

- **Status:** Draft for owner review — this is a design document. It does not implement a schema, migration, repository, route, or provider change.
- **Date:** 2026-11-17
- **Scope:** The C1 design deliverable in [native CMS cutover](native-cms-cutover.md#c1--native-content-model-and-tenant-scoped-repositories). It derives the target from the [C0 cutover inventory](native-cms-c0-inventory.md).
- **Source of truth:** C0’s 36-type disposition: **21 native collections, 13 derived/audit stores, 2 optional auth adapters, and 0 retirements** (the 2026-11-19 decision retained `playbook` as native). The ten existing `quicksilver/ontology` collection schemas are the starting point; the remaining retained types are added here.
- **Field and ownership input:** [Field-level mapping and tenant ownership registry](native-cms-field-mapping-tenant-registry.md). It maps every retained source field and defines the pre-C1 ownership gate; this document supplies the target collections and relations.
- **Exit-gate tests:** [C1 acceptance test matrix](native-cms-c1-acceptance-test-matrix.md). The 50 named cases are the executable C1 exit gate; this document supplies the contracts they test.
- **Implementation sequence:** [C1 implementation sequence](native-cms-c1-implementation-sequence.md). It orders the design into evidence-gated stages; it does not implement them.
- **Rich text:** [Native CMS rich-text and Portable Text parity contract](native-cms-rich-text-parity-contract.md). It governs any field explicitly designated as rich text; it does not promote existing plain-text fields.
- **Not authorized:** No production data is migrated, no Sanity or Strapi status changes, no routes are wired, and no code is generated from this draft. C1 remains unimplemented.

## 1. Design invariants

1. **Tenant comes from the principal.** A repository call takes a required `tenantId` supplied by the authenticated principal. No repository reads `QUICKSILVER_TENANT_ID`, a request body, a query parameter, or a default tenant.
2. **A tenant column is not a boundary.** Every same-tenant relation is a composite relation `(tenant_id, target_id)` with a database-enforced reference to `(tenant_id, id)`. The repository also checks target existence and tenant equality before writing.
3. **One logical record, explicit revisions.** Editable content keeps a current row plus immutable revision snapshots. A write states the revision it expects; a mismatch returns a conflict rather than overwriting.
4. **Authority is not moved into content.** Decisions, approvals, execution, and policy resolution remain NQC Kernel operations. Collections store the evidence and inputs the kernel produced or consumed; they do not authorize anything.
5. **Audit is part of the mutation.** Authorization, execution, publication, department, and decision audit rows are appended in the same transaction as the mutation they describe. A failed audit write aborts the mutation.
6. **Append-only means append-only.** Audit, ledger, evaluation, trace, and review records have no update or hard-delete path. Retention changes are metadata-only and audited. Editable content is removed with a tombstone, never a hard delete.
7. **Draft and published are different reads.** Editorial readers default to the published revision. Editors may read drafts with an explicit permission. A missing or unpublished revision is not silently replaced by the current draft.
8. **Queries are bounded and deterministic.** Every list, graph, and tree has a maximum node/page count, a stable ordering, an opaque cursor, and a `truncated` result. Malformed input fails closed; a cross-tenant ID returns no foreign record.
9. **No CMS fallback in the native path.** These repositories must load with Sanity, external Strapi, and all `SANITY_*`/`NEXT_PUBLIC_SANITY_*` variables unset.

## 2. Shared storage contract

### 2.1 Common columns and keys

Every retained table carries:

| Column | Rule |
|---|---|
| `id` | Opaque, stable, generated once. Never reused, including after tombstone or purge. |
| `tenant_id` | Required text. Immutable after insert; an update that changes it is refused. |
| `tenant_id, id` | Unique together. This is the target key for composite relations; `id` may also be unique globally. |
| `created_at`, `created_by` | Required for mutable and append-only records. |
| `updated_at`, `updated_by` | Required for mutable records; absent or equal to creation on append-only rows. |
| `revision` | Monotonic integer for mutable content, starting at 1. Incremented on every content, lifecycle, tombstone, or restore write. |
| `lifecycle` | Type-specific state (see the collection tables). Not a substitute for the domain status field. |
| `published_revision` | Set only when a revision is published; absent for unpublished and append-only records. |
| `deleted_at`, `deleted_by`, `delete_reason`, `purge_after` | Tombstone fields. All four are set together or none is. |

Business uniqueness is always tenant-qualified. Examples: one root `organization` per tenant; `(tenant_id, agent_id, version)` for agent definitions; `(tenant_id, graph_id, version)` for automation workflows; `(tenant_id, graph_id)` for a publication head; `(tenant_id, run_id, seq)` for money entries. A unique index excludes tombstoned rows where the business key may be reused only if the owner explicitly allows reuse; the default is no reuse.

### 2.2 Same-tenant composite relations

- A single-valued relation stores `target_id`; its foreign key is `(tenant_id, target_id) -> (tenant_id, id)`. Both columns must be null together for an optional relation.
- A multi-valued relation uses a typed join table with `tenant_id`, `from_id`, and `to_id`. It has two composite foreign keys: `(tenant_id, from_id)` and `(tenant_id, to_id)`. Both endpoints therefore resolve in the same tenant even though the join table has one tenant column.
- A relation with a discriminator (for example decision context, which may reference an entity, capability, or policy) uses nullable typed columns plus the composite foreign key for the populated column. A check constraint requires exactly one target type.
- The default delete behavior is `RESTRICT`. Content is tombstoned, not hard-deleted. A tombstoned target remains resolvable for audit, but normal reads exclude it and new relations to it are refused unless the relation is explicitly `retain_after_delete`.
- Relation writes verify the target is in the same tenant, exists, and is not purged. A cross-tenant target, an unresolved target, or a target that is not visible to the caller fails closed. It is never rewritten to a same-tenant row and never silently dropped.
- A tenant change is never a relation repair path. Moving a record between tenants requires an explicit migration and is out of C1.

### 2.3 Revisions, drafts, and optimistic concurrency

Editable aggregates use a current row plus `qs_content_revisions`:

| Revision field | Rule |
|---|---|
| `tenant_id, record_type, record_id` | Identifies the logical aggregate. |
| `revision` | Positive integer, unique per aggregate, allocated in the same transaction as the current-row update. |
| `snapshot` | The complete typed payload after the write, stored as validated JSON or typed columns; it is the audit-quality revision body. |
| `digest` | SHA-256 over the canonical snapshot and revision metadata. |
| `actor_id`, `created_at`, `state` | Who wrote it and whether it is a draft, published, archived, tombstoned, or restored revision. |

The current row is a projection of the latest revision. It carries `revision` and `published_revision`; it never carries Sanity’s `_rev`. A client write supplies `expectedRevision` (or `If-Match`). The repository performs a compare-and-swap update, allocates the next revision, writes the snapshot, and writes the audit row in one transaction. A concurrent writer gets **409 conflict**, not last-writer-wins.

Publishing is a lifecycle write that marks a specific revision published and advances `published_revision`; it does not copy a second document. Reading a published record resolves that snapshot. Reading a draft requires an editor capability and `revision` (or the latest draft explicitly). Archiving, soft delete, and restore each allocate a revision and an audit entry.

Append-only stores do not use this revision table. Their immutable identity is `(tenant_id, seq)` or `(tenant_id, event_id)`, with a hash chain where the source already has one. Heads and pointers use a single `cas_revision` integer; they are not editorial documents.

### 2.4 Idempotency and tombstones

`qs_idempotency_keys` stores `(tenant_id, operation, key)`, a hash of the normalized request, the resulting record ID, the response digest, and an expiry. Repeating the same key with the same request returns the original result. Reusing it with a different request is a conflict. Keys are tenant-scoped; one tenant cannot observe or consume another tenant’s key.

Soft delete writes the tombstone fields and a revision/audit row, then hides the record from normal queries. Unique indexes treat tombstoned rows as inactive except for the tombstone lookup itself. Restore requires an explicit audit event, a new revision, and a check that no active row now occupies the business key. A purge is a separate, owner-approved retention operation; it is never the default delete path and never applies to decisions or audit rows.

### 2.5 Repository boundary

All repositories live behind a chassis-neutral interface, whether the implementation uses Strapi, SQL, or another store:

```ts
type TenantId = string

interface PageRequest {
  cursor?: string
  limit: number // 1..100; callers cannot raise the server maximum
}

interface WriteOptions {
  actorId: string
  expectedRevision?: number
  idempotencyKey?: string
}

interface Page<T> {
  items: T[]
  nextCursor: string | null
  truncated: boolean
}
```

Every method takes `tenantId` as its first argument. Repository errors are typed and fail closed: `NotFound` (including a foreign-tenant ID), `CrossTenantRelation`, `RevisionConflict`, `IdempotencyConflict`, `UnresolvedRelation`, `MalformedQuery`, `AppendOnlyViolation`, and `AuditWriteFailed`. The HTTP layer maps them later; C1 does not add routes.

## 3. Native collections (21)

The table names are proposed persistence names, not a commitment to SQL DDL. Field lists name the retained source fields; a one-for-one field mapping is required, not merely the examples shown.

| Native collection | Source `_type` | Retained fields (core) | Same-tenant relations | Lifecycle / revision | Repository |
|---|---|---|---|---|---|
| `qs_organizations` | `organization` | `name`, `slug`, `mission`/`description`, `resources` | departments, policies, objectives, resource entities | draft/published; revisioned; one root per tenant | `OrganizationRepository` |
| `qs_departments` | `department` | `name`, `purpose`/`description`, economics run/department/status/budget/revision/proposal/approval/evidence fields; legacy `companyId` normalized to `tenant_id` | organization, parent/children, leader/members, capabilities, objectives, workflows, metrics | draft/published; revisioned; economics changes use native revisions | `DepartmentRepository` |
| `qs_entities` | `entity` | `name`, `entityType`/`kind` (human, agent, robot, service, contractor, system), externalId, metadata, availability, riskProfile, costProfile | departments, capabilities, permissions/constraints (policies), reportsTo, department | draft/published; revisioned | `EntityRepository` |
| `qs_capabilities` | `capability` | name, description, requiredSkills, resource/action (legacy), riskLevel, policyScopes, inherits, requires, conflictsWith, riskMultiplier, requiredTools, authorizedEntities | inherits/requires/conflictsWith capabilities, authorized entities, governing policies | draft/published; revisioned; graph validity required | `CapabilityRepository` |
| `qs_policies` | `policy` | name, description (ontology), scope, priority, rules, effect, maxRiskLevel, whenAll, effective/expiration dates, lineageId, version, appliesTo, approvalRequirements, supersedes | organization, capabilities, appliesTo entities, approval entities, supersedes policies | draft/published; revisioned per lineage; policy snapshot digest | `PolicyRepository` |
| `qs_objectives` | `objective` | name/title, description, priority, deadline, constraints, successMetrics, budget, status | organization, department, owner, parent/children, workflows, evidence, decisions, metrics | draft/published; revisioned; no cycles | `ObjectiveRepository` |
| `qs_workflows` | `workflow` | name, description (ontology), version, trigger, initialState, states, transitions with structured guards, requiredCapabilities, approvalRequirements, failureHandlers, rollbackProcedure, legacy `definition` JSON if present | department, objective, required capabilities, approval entities, decisions | draft/published/deprecated; revisioned | `ProcessDefinitionRepository` |
| `qs_automation_workflows` | `automationWorkflow` | name, graphId, schemaVersion, version, lifecycle, graphDigest, authored/reviewed/published/deprecated metadata, rollbackOfVersion, entryNodeId, nodes, edges | publication head; agent/tool references are validated strings until native agent/tool IDs are bound | draft/review/active/archived; immutable version row; revision only for draft edits | `AutomationWorkflowRepository` |
| `qs_workflow_publication_heads` | `workflowPublicationHead` | graphId, activeVersion, updatedAt, casRevision | active `automationWorkflow` by tenant/graph/version | pointer only; CAS; one per tenant/graph | `WorkflowPublicationHeadRepository` |
| `qs_evidence` | `evidence` | title, type, source, claim, confidence, effectiveDate, observedAt (ontology), content | objective, metric, relatedEntities, supports objectives, contradicts evidence, decisions | draft/published; revisioned; contradiction edges stay same-tenant | `EvidenceRepository` |
| `qs_decisions` | `decision` | question, legacyTitle (ontology), context, candidateActions, selectedAction, reasoningSummary, constraints, policyResolutions, policyChecks, riskLevel, requiredApproval, policySnapshotVersion, approvalRecord, executionAudit, safetyDecision, evaluation, reviewerNotes, status, kind, faultInjection, kernelRecommendation, kernelAuthorized, rollbackOf, observedDeviation, process, requestedBy, proposedBy, approvedBy, createdAt, executedAt; legacy `proposal`/`outcome` preserved when present | context entity/capability/policy, objective, workflow, proposedBy/approvedBy entities, evidence, rollbackOf, decision events | append-only event authority; current row projection; no hard delete; status is a projection | `DecisionRepository` |
| `qs_metrics` | `metric` | name, unit, value (`currentValue` legacy alias), baseline, targetValue (legacy), direction, objective, relatedDecision, department (ontology), observedAt (legacy), updatedAt, faultInjection (test-only) | objective, department, related decision, observations, evidence | draft/published for the definition; current value revisioned; observations append-only | `MetricRepository` |
| `qs_intent_graphs` | `intentGraph` | schema version, graph payload, provenance-tagged variables/edges, question feedback; host store shape retained | tenant and graph history; no cross-tenant intent IDs | revisioned graph revisions; Sanity is only a projection | `IntentGraphRepository` |
| `qs_intent_ledger_entries` | `intentLedgerEntry` | sequence, previousHash, hash, signature, actor, role, change, previousValue, reason | tenant-local chain; no relation to another tenant | append-only, hash-chained; no update/delete | `IntentLedgerRepository` |
| `qs_agent_definitions` | `agentDefinition` | tenant, agentId, displayName, description, version, lifecycle, manifest, definitionDigest, authored/reviewed/published metadata, rollbackFromVersion/Digest | agent publication head; built-in manifests remain code | draft/review/active/archived; immutable published version; draft revisioned | `AgentDefinitionRepository` |
| `qs_agent_publication_heads` | `agentPublicationHead` | agentId, activeVersion, updatedAt, casRevision | active `agentDefinition` by tenant/agent/version | pointer only; CAS; one per tenant/agent | `AgentPublicationHeadRepository` |
| `qs_commitments` | `commitment` | title, direction, dueAt, checkBackAt, status, deferredUntil, context, createdBy, createdAt, processHistory | contact, linked decision | open/done/deferred/dropped; revisioned; soft delete; human-only transitions | `CommitmentRepository` |
| `qs_contacts` | `contact` | name, kind (person/organization), email, notes, checkBackCadence, lastInteractionAt, status, externalSync, created/updated metadata | commitments, scheduled items, drafted communications | active/archived; revisioned; soft delete; no direct web route yet | `ContactRepository` |
| `qs_scheduled_items` | `scheduledItem` | title, kind, startsAt, endsAt, allDay, recurrence, notes, status, createdBy, createdAt, externalSync | linked commitment, decision, contact | upcoming/done/cancelled; revisioned; soft delete; external sync optional | `ScheduledItemRepository` |
| `qs_drafted_communications` | `draftedCommunication` | kind (email/message/note), recipient (`to`), subject, body, linkedCommitment, linkedDecision, status, deliveryChannel, sentAt, createdBy, createdAt, processHistory | contact, commitment, decision | draft/approved/sent/cancelled; revisioned; delivery adapter separate | `DraftedCommunicationRepository` |
| `qs_playbooks` | `playbook` | playbookId, version, name, modes, definitionJson, status, digest, authoredBy, publishedBy, publishedAt | none carried; definitions are self-contained and validated as one document | draft/published; revisioned; content digest pinned; human-and-not-author publish only | `PlaybookRepository` |

### 3.1 Internal native tables

These are implementation support, not additional Sanity types:

| Table | Purpose |
|---|---|
| `qs_content_revisions` | Immutable revision snapshots for editable aggregates (§2.3). |
| `qs_decision_events` | Append-only, ordered decision transitions. The `decision` row is a projection; the event log is the authority for history. Each event records `seq`, event type, from/to status, actor, time, action fingerprint, policy snapshot, process version/revision, payload digest, previous hash, and hash. |
| `qs_metric_observations` | Append-only value observations produced by decision `observe` and native metric updates. The `metric` row is the current projection. |
| `qs_idempotency_keys` | Tenant-scoped idempotency records (§2.4). |
| Typed relation tables | One per multi-valued relation, such as `qs_department_members`, `qs_department_capabilities`, `qs_entity_capabilities`, `qs_entity_policy_links`, `qs_capability_inherits`, `qs_capability_requires`, `qs_capability_conflicts`, `qs_objective_children`, `qs_workflow_required_capabilities`, `qs_decision_evidence`, `qs_decision_context`, `qs_evidence_related_entities`, `qs_evidence_supports`, `qs_policy_applies_to`, and `qs_policy_approvals`. Every join carries one `tenant_id` and both composite endpoint keys. |

## 4. Derived and audit stores (13)

These are durable native stores. “Derived” does not mean disposable, and none is editable content.

| Native store | Source `_type` | Key and ordering | Retained fields | Write rule | Repository |
|---|---|---|---|---|---|
| `qs_department_execution_audits` | `departmentExecutionAudit` | proposal/action identity; ordered by executedAt, id | proposalId/digest, actionId/digest, approvalDigest, runId, departmentId, action, from/to status, from/to budget, from/to revision, approvedBy, executedAt | append-only; no update/delete; failed append aborts execution | `DepartmentAuditRepository` |
| `qs_workflow_publication_audits` | `workflowPublicationAudit` | event seq; ordered by at, id | event, graphId, version, actorId, at, graphDigest, detail | append-only; publication transition fails if append fails | `WorkflowAuditRepository` |
| `qs_workflow_executions` | `workflowExecution` | `(tenant_id, run_id)`; ordered by startedAt desc, runId | workflowId, version, digest, requestedBy, status, startedAt, completedAt, durationMs, evaluationCount | metadata-only insert; no request/response bodies; no update except terminal status if the run is not yet closed | `WorkflowExecutionRepository` |
| `qs_evaluation_records` | `evaluationRecord` | evaluation id; ordered by evaluatedAt, id | source, agent, task, model, subject, requester, run/node, scores, issues, corrections, safety decision | append-only; no read route until C2 | `EvaluationRepository` |
| `qs_shadow_recommendations` | `shadowRecommendation` | recommendation id; ordered by createdAt, id | recommendation, prediction, verdict, outcome | append-only; shadow mode never executes | `ShadowLogRepository` |
| `qs_aura_verdict_learners` | `auraVerdictLearner` | `(tenant_id, intent_id)` | intent id, observation count, learner state, updatedAt, revision | derived upsert; rebuildable; revision on every update | `LearnerStateRepository` |
| `qs_money_entries` | `moneyEntry` | `(tenant_id, run_id, seq)`; ordered by run, seq | kind, amountUsd, category, description, experimentId, sourceType/ref, spendDecisionId/recommendation/risk/reasons, confirmedBy/At, occurredAt, recordedAt/by, prevHash, hash | append-only, hash-chained per tenant/run; verify on load | `MoneyLedgerRepository` |
| `qs_experiment_records` | `experimentRecord` | `(tenant_id, run_id, experiment_id)` | position, status, hypothesis, playbookId, budgetUsd, durationDays, customerFacing, proposedBy, definitionJson, digest, started/ends, measurementsJson, decisionsJson | definition/digest fixed after draft; measurements/decisions append; revisioned | `ExperimentRepository` |
| `qs_content_reviews` | `contentReview` | review id; ordered by reviewedAt, id | reviewed text/digest, verdict, components, reviewer kind, time, experiment, channel | append-only; manual and WAES reviews remain distinguishable | `ContentReviewRepository` |
| `qs_agent_publication_audits` | `agentPublicationAudit` | event seq; ordered by at, id | event, agentId, version, actorId, at, definitionDigest, detail | append-only; publication transition fails if append fails | `AgentAuditRepository` |
| `qs_authorization_decision_audits` | `authorizationDecisionAudit` | audit id; ordered by at, id | tenant, route, permissions, actor, outcome, status, time, decision code | append-only; write failure fails the request closed | `AuthorizationAuditRepository` |
| `qs_telemetry_trace_spans` | `telemetryTraceSpan` | span id; ordered by startedAt, spanId | metadata-only request/model/tool/evaluation identities, timing, status, correlation IDs, tenant | append-only; no prompts, outputs, tool arguments, or secrets | `TraceRepository` |
| `qs_reviews` | `review` | review id; ordered by generatedAt desc, id | title, cadence, periodStart/End, summary, highlights, metrics counts, decision/commitment references, generatedAt, generatedBy | generated snapshot; insert-only; never an authorization artifact | `OperatorReviewRepository` |

### 4.1 Excluded from the C1 CMS schema

- `oidcLoginTransaction` and `oidcWebSession` remain auth-plane adapters. They are not copied into CMS content and are not queried through these repositories.
- `playbook` is **retained** (2026-11-19) and appears in §3 above as `qs_playbooks`, with the same composite-FK and revision rules. It stays unimplemented until C1 builds it, and `deploy/playbooks/*.json` remains the runtime authority until M4 integration. It is counted in the 34 retained stores.
- Binary Sanity assets are not one of the 36 schema types. Their native object-store mapping belongs to the asset gate, not this collection list. See the [asset tenancy and sharing policy](native-cms-asset-tenancy-sharing-policy.md) for exclusive/shared ownership, keys, deletion, and delivery.

## 5. Repository map

### 5.1 Shared content surface

Repositories may expose only the methods their aggregate needs. The common editable-content surface is:

```ts
interface ContentRepository<T> {
  get(tenantId: TenantId, id: string, opts?: { revision?: number; includeDraft?: boolean }): Promise<T>
  list(tenantId: TenantId, query: PageRequest & Record<string, unknown>): Promise<Page<T>>
  create(tenantId: TenantId, input: unknown, opts: WriteOptions): Promise<T>
  update(tenantId: TenantId, id: string, patch: unknown, opts: WriteOptions & { expectedRevision: number }): Promise<T>
  publish(tenantId: TenantId, id: string, revision: number, opts: WriteOptions): Promise<T>
  archive(tenantId: TenantId, id: string, opts: WriteOptions): Promise<T>
  softDelete(tenantId: TenantId, id: string, opts: WriteOptions): Promise<T>
  restore(tenantId: TenantId, id: string, opts: WriteOptions): Promise<T>
  revisions(tenantId: TenantId, id: string, page: PageRequest): Promise<Page<Revision<T>>>
  getRevision(tenantId: TenantId, id: string, revision: number): Promise<Revision<T>>
}
```

`create` and `update` validate the full payload, all relations, the idempotency key, and the expected revision before writing. `publish` requires the caller’s permission at the route layer; the repository enforces the state transition and audit. `softDelete` never cascades a hard delete.

### 5.2 Specialized methods

| Repository | Additional methods and rules |
|---|---|
| `OrganizationRepository` | `getRoot(tenantId)`; refuses a second root; no default-tenant fallback. |
| `DepartmentRepository` | `tree(tenantId)`, `members(tenantId, departmentId)`; parent must be same tenant and cannot create a cycle. |
| `EntityRepository` | `directory(tenantId, page)`, `byDepartment(tenantId, departmentId)`; projections resolve only same-tenant departments/capabilities/policies. |
| `CapabilityRepository` | `graph(tenantId)`, `resolveScopes(tenantId, capabilityIds)`; validates inherits/requires/conflicts edges and risk multiplier before write. |
| `PolicyRepository` | `live(tenantId, scope, at)`, `lineage(tenantId, lineageId)`; policy snapshots are derived from native revisions; no free-text-only resolver. |
| `ObjectiveRepository` | `tree(tenantId, rootId?)`; parent/child cycles refused; owner/department/evidence/decision relations same-tenant. |
| `ProcessDefinitionRepository` | `getDefinition(tenantId, workflowId, version?)`; validates states, transitions, guards, terminal states, and version before write. |
| `AutomationWorkflowRepository` | `getByGraph(tenantId, graphId, version?)`, `diff(tenantId, graphId, fromVersion, toVersion)`, `publish`, `rollback`; digest and DAG validation required. |
| `WorkflowPublicationHeadRepository` | `cas(tenantId, graphId, expectedCasRevision, activeVersion)`; exactly one head per graph. |
| `EvidenceRepository` | `forMetric(tenantId, metricId)`, `contradictions(tenantId)`; support/contradiction targets must resolve same-tenant. |
| `DecisionRepository` | `appendEvent(tenantId, decisionId, event, opts)`, `history(tenantId, filters)`, `current(tenantId, id)`; the event log is authoritative; direct row updates are forbidden. |
| `MetricRepository` | `observe(tenantId, metricId, observation, opts)`, `history(tenantId, metricId)`; observation append and current projection update are one transaction. |
| `IntentGraphRepository` | `getGraph(tenantId, graphId)`, `saveRevision(...)`; provenance and question feedback retained; no Sanity projection as authority. |
| `IntentLedgerRepository` | `append(tenantId, entry)`, `verify(tenantId, runId)`; hash chain verified on load. |
| `AgentDefinitionRepository` | `getVersion(tenantId, agentId, version)`, `catalog(tenantId)`, `publish`, `rollback`; digest must match manifest and tenant/agent/version identity. |
| `AgentPublicationHeadRepository` | `cas(tenantId, agentId, expectedCasRevision, activeVersion)`; exactly one head per agent. |
| `CommitmentRepository` | `transition(tenantId, id, expectedRevision, transition, actor)`; human-only transitions; contact/decision links same-tenant. |
| `ContactRepository` | `resolve(tenantId, id)`, `list(tenantId, page)`; draft/commitment links refuse a foreign contact. |
| `ScheduledItemRepository` | `calendar(tenantId, from, to, page)`, `create/update`; recurrence and links validated; external sync is optional metadata. |
| `DraftedCommunicationRepository` | `list(tenantId, page)`, `create/update`, `markSent`; delivery adapters receive only the tenant-qualified draft. |
| `WorkflowAuditRepository`, `AgentAuditRepository`, `DepartmentAuditRepository`, `AuthorizationAuditRepository` | `append`, `list`; no update/delete. Error propagation is mandatory. |
| `MoneyLedgerRepository`, `IntentLedgerRepository` | `append`, `verify`, `list`; hash chain is per tenant and per run/sequence. |
| `TraceRepository`, `EvaluationRepository`, `ContentReviewRepository`, `OperatorReviewRepository` | `append`, `list`; metadata/retention rules from C0; no mutation path. |
| `WorkflowExecutionRepository` | `recordStart`, `recordCompletion`, `list`; metadata only; run identity matches host run history without creating a second authority. |
| `LearnerStateRepository`, `ExperimentRepository` | Derived upsert/append methods; they do not grant authority. |

## 6. Same-tenant relation inventory

The “relation” column lists the logical edge enforced by composite keys. A `1:N` edge stores the tenant and target on the many side; an `M:N` edge uses a typed join table with both composite endpoint keys.

| Source | Relation | Target | Cardinality | Delete / tombstone rule |
|---|---|---|---|---|
| organization | departments | department | 1:N | restrict; tombstoned department hidden |
| organization | policies | policy | 1:N | restrict |
| organization | objectives | objective | 1:N | restrict |
| organization | resources | entity | M:N | restrict |
| department | parentDepartment | department | 1:N | same tenant; no cycle; restrict |
| department | leader / members | entity | 1:N / M:N | restrict; member removal is audited |
| department | capabilities | capability | M:N | restrict |
| department | objectives / workflows / metrics | objective / workflow / metric | 1:N each | restrict |
| entity | departments | department | M:N | restrict |
| entity | capabilities | capability | M:N | restrict |
| entity | permissions / constraints | policy | M:N | restrict; policy must be same tenant |
| entity | reportsTo | entity | 1:N | no self/cycle; restrict |
| entity | department | department | 1:N | restrict |
| capability | inherits / requires / conflictsWith | capability | M:N each | graph validation; no cross-tenant edge |
| capability | authorizedEntities | entity | M:N | restrict |
| capability | policies | policy | M:N | restrict |
| policy | organization | organization | 1:N | restrict |
| policy | appliesTo / approvalRequirements | entity | M:N each | restrict |
| policy | supersedes | policy | M:N | same lineage/tenant; no cross-tenant supersession |
| objective | organization / department | organization / department | 1:N each | restrict |
| objective | owner | entity | 1:N | restrict |
| objective | parentObjective / childObjectives | objective | 1:N | no cycle; restrict |
| objective | workflows / evidence / decisions / metrics | workflow / evidence / decision / metric | 1:N each | restrict |
| workflow | department / objective | department / objective | 1:N each | restrict |
| workflow | requiredCapabilities / approvalRequirements | capability / entity | M:N each | restrict |
| workflow | decisions | decision | 1:N | restrict |
| automationWorkflow | publication head | workflowPublicationHead | 1:1 per graph | head points to a version in same tenant/graph |
| evidence | objective / metric | objective / metric | 1:N each | restrict |
| evidence | relatedEntities | entity | M:N | restrict |
| evidence | supports | objective | M:N | restrict |
| evidence | contradicts | evidence | M:N | same tenant; contradiction is not a deletion |
| evidence | decisions | decision | M:N | restrict |
| decision | context | entity / capability / policy | M:N via typed context table | exactly one target type per row; all same tenant |
| decision | objective / workflow | objective / workflow | 1:N each | restrict |
| decision | proposedBy / approvedBy | entity | 1:N each | restrict; actor IDs are recorded even if entity is later tombstoned |
| decision | evidence | evidence | M:N | restrict |
| decision | rollbackOf | decision | 1:N | same tenant; no rollback-of-rollback |
| metric | objective / relatedDecision | objective / decision | 1:N each | restrict |
| agentPublicationHead | active definition | agentDefinition | 1:1 per agent | version must exist in same tenant/agent |
| commitment | counterparty / linkedDecision | contact / decision | 1:N each | restrict; a tombstoned contact remains for audit only |
| scheduledItem | linkedCommitment / linkedDecision / linkedContact | commitment / decision / contact | 1:N each | restrict; normal reads require active targets |
| draftedCommunication | contact / commitment / decision | contact / commitment / decision | 1:N each | restrict; delivery metadata does not create a cross-tenant relation |
| workflowPublicationAudit | graph/version | automationWorkflow | N:1 | append-only; target may be archived, never rewritten |
| workflowExecution | workflow/version | automationWorkflow | N:1 | append-only metadata |
| agentPublicationAudit | agent/version | agentDefinition | N:1 | append-only |
| departmentExecutionAudit | department | department | N:1 | append-only; department tombstone does not erase audit |
| review | decisions / commitments | decision / commitment | M:N | generated snapshot; references preserved |
| experimentRecord | decisions / evidence / playbookId | decision / evidence / `playbookId` (no FK unless retained) | M:N / 1:N | derived history; playbookId validates only if that collection is retained |
| moneyEntry | spendDecision / experiment | decision / experimentRecord | 1:N each | append-only; hashes are per tenant/run |
| contentReview | experiment | experimentRecord | 1:N | append-only |
| telemetryTraceSpan | run/decision/evaluation correlation | no hard FK | logical IDs | metadata-only; no cross-tenant lookup |

## 7. Six query contracts

These replace the six TODO functions in `quicksilver/query/index.ts`. Their names stay stable for C1 fixtures. Each function takes `tenantId` as a required argument; no query accepts a caller-supplied tenant override. The return types below are the C1 contract; C2 may adapt them to route response shapes without changing tenant or ordering semantics.

### 7.1 `getCapabilityGraph(tenantId)`

Returns the published capability graph for one tenant.

```ts
interface CapabilityGraph {
  nodes: Array<{ id: string; name: string; riskLevel: number; policyScopes: string[] }>
  edges: Array<{ from: string; to: string; kind: 'inherits' | 'requires' | 'conflictsWith' }>
  truncated: boolean
}
```

- Includes only published, non-tombstoned capabilities.
- Edges are resolved through same-tenant composite relations; a dangling or foreign edge is a graph-integrity failure, not an omitted edge.
- Bounded to 500 nodes and 2,000 edges. Ordering is by node `id`, then edge `(from, to, kind)`.
- Fixtures: inheritance chain, dependency, conflict pair, and a cycle/dangling-edge refusal. A cross-tenant edge cannot be represented and a cross-tenant query returns no foreign nodes.

### 7.2 `findContradictions(tenantId)`

Returns deterministic findings without resolving or mutating anything.

```ts
interface ContradictionFinding {
  id: string
  kind: 'policy-conflict' | 'evidence-contradiction' | 'metric-drift'
  subjectIds: string[]
  policyIds?: string[]
  evidenceIds?: string[]
  severity: 'low' | 'medium' | 'high'
  reason: string
}
```

- Policy findings compare applicable live policies using explicit scope, priority, lineage, effect, and effective dates; same-priority conflicts remain findings for a human/kernel decision.
- Evidence findings follow `supports`/`contradicts` within the tenant and preserve source/provenance for every finding.
- Metric drift uses versioned observations and never invents a missing value.
- Ordering is by `(kind, id)`, bounded to 200 findings. No cross-tenant evidence or policy is compared, and no finding is written back as authority.

### 7.3 `getWorkflowDAG(tenantId, workflowId)`

Returns the validated directed acyclic graph for a published automation workflow. `workflowId` is the native `automationWorkflow.graphId`; the process-definition `workflow` store is a separate repository read and is not this contract.

```ts
interface WorkflowDAG {
  graphId: string
  version: number
  digest: string
  entryNodeId: string
  nodes: Array<{ id: string; kind: string; label: string; config: unknown }>
  edges: Array<{ id: string; from: string; to: string; branch?: 'true' | 'false' }>
  truncated: boolean
}
```

- Resolves the active publication head, then the exact same-tenant `automationWorkflow` version. A missing head/version or a foreign graph returns `null`; it never falls back to another tenant or a draft.
- Runs the kernel’s existing graph validation before returning. An invalid graph, duplicate node/edge ID, missing entry node, or cycle where a DAG is required fails closed.
- Bounded to the graph’s validated 500-node/1,000-edge limits; node and edge order is by ID, not insertion order.
- Fixtures: a valid linear graph, a branch/merge, an unpublished graph, a stale head, and a malformed graph refusal.

### 7.4 `getObjectiveTree(tenantId, objectiveId?)`

Returns one objective subtree, or the tenant’s roots when no ID is supplied.

```ts
interface ObjectiveNode {
  id: string
  name: string
  parentId: string | null
  ownerId: string | null
  departmentId: string | null
  status: string
  childIds: string[]
}
interface ObjectiveTree {
  roots: ObjectiveNode[]
  truncated: boolean
}
```

- Only active/published, non-tombstoned objectives are returned. A foreign or missing `objectiveId` returns an empty tree, not another tenant’s tree.
- Parent/child edges are same-tenant and cycle-free. Traversal is deterministic pre-order by `(name, id)`; depth is bounded to 32 and nodes to 1,000. `truncated` says whether a bound was hit.
- Fixtures: three-level tree, orphan refusal, cycle refusal, cross-tenant root, and depth boundary.

### 7.5 `getEvidenceForMetric(tenantId, metricId)`

Returns evidence directly linked to one metric, newest first.

```ts
interface MetricEvidence {
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
```

- Resolves the metric and evidence only within the tenant; a missing/foreign metric returns `[]` and never foreign rows.
- Uses the direct `evidence.metric` relation. Evidence reached only through an objective is not silently included; a caller that wants that wider graph uses a separate explicit query in C3.
- Ordering is `(observedAt DESC NULLS LAST, id ASC)`, bounded to 100 by default and 500 maximum. A malformed metric ID or cursor is refused.
- Fixtures: metric with two evidence records, one contradiction, no evidence, foreign metric, tombstoned evidence, and a 500-row cap.

### 7.6 `getDecisionHistory(tenantId, filters?)`

Returns immutable decision events, with the current decision state available as a projection.

```ts
interface DecisionHistoryFilter {
  decisionId?: string
  status?: string[]
  kind?: 'plan' | 'rollback'
  objectiveId?: string
  workflowId?: string
  actorId?: string
  from?: string // inclusive ISO timestamp
  to?: string   // exclusive ISO timestamp
  cursor?: string
  limit?: number
  order?: 'asc' | 'desc'
}
interface DecisionEvent {
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
```

- Reads `qs_decision_events`, not a mutable history array. The projection supplies current status/filter matches; the event sequence is authoritative.
- Only the caller’s tenant is queried. A foreign decision ID yields no events; a cross-tenant filter value is ignored or refused, never used to widen scope.
- Ordering is stable by `(at, seq, eventId)`; default `desc`, limit 1–100. The cursor is opaque and tenant-bound. Malformed status/date/kind filters and an invalid cursor are refused.
- Fixtures: proposed → approved → executed, a rollback chain, an empty history, a foreign decision ID, an invalid cursor, and a page boundary that proves no duplicate or skipped event.

## 8. C1 verification map

| C1 requirement | Design evidence | Acceptance cases |
|---|---|---|
| Every retained type has a native schema | 21 native + 13 derived tables above; 2 auth adapters excluded; 0 retirements. Every retained source field is classified in the [field mapping](native-cms-field-mapping-tenant-registry.md). | A01 |
| Same-tenant composite relations | §2.2 and §6; every relation is tenant-qualified at the database and repository boundaries. | B01–B11 |
| Revisions and optimistic concurrency | §2.3; expected revision, immutable snapshots, 409 on mismatch. | C01–C08 |
| Draft/publish | Per-collection lifecycle columns; published revision pointer; default published read. | C03, C06, E03 |
| Idempotency | §2.4; tenant-scoped key with request digest and replay result. | D01–D06 |
| Append-only audit/derived stores | §4; no update/delete; same-transaction append; hash chains where the source has one. | C08, E04–E08 |
| Six query contracts | §7; typed outputs, deterministic ordering, bounds, refusal fixtures. | G01–G07 |
| Native without Sanity/Strapi | §1.9 and repository boundary; no environment-derived tenant and no provider fallback. | A01–A04 |

The executable C1 exit gate is the [C1 acceptance test matrix](native-cms-c1-acceptance-test-matrix.md): **50/50 cases, zero skipped, zero todo**. A design claim in this table does not pass the gate until its named case does. The fixtures prove the repository contract; they are not production migration evidence.

## 9. Decisions still owned outside this draft

- **`playbook`:** **decided 2026-11-19 — retained** as a native M4 collection ([brief §6](native-cms-playbook-decision-brief.md#6-sign-off)). It is one of the 34 retained stores, its repository is `PlaybookRepository`, and `deploy/playbooks/*.json` remains the runtime authority until M4 integration.
- **Chassis:** **decided 2026-11-19 — direct native repositories**, with no CMS host ([packet §3](native-cms-c0-unblock-packet.md#3-decision-2--persistence-adapterchassis)). The composite-key and revision rules above are unchanged and enforceable only in the repository layer.
- **Production counts and migration scope:** C0’s seed counts are not production counts; the read-only export is still required before any mapping is treated as complete.

No schema, migration, repository, route, provider status, or runtime behavior is changed by this document.
