# Field-level mapping and tenant ownership registry (draft)

- **Status:** Design-only draft for C1 readiness. No runtime schema, repository, migration, or route is implemented by this document.
- **Date:** 2026-11-17
- **Sources:** The 36-type [C0 cutover inventory](native-cms-c0-inventory.md), the [C1 schema and repository map](native-cms-c1-schema-repository-map.md), and the registered Studio/Quicksilver schema files.
- **Scope:** The 21 native collections and 13 derived/audit stores retained by C1. The two OIDC types remain auth-plane adapters and are not mapped into CMS content. `playbook` was retained on 2026-11-19, so its field-mapping table is a C1 Stage-0 requirement rather than a conditional entry.
- **Hard rule:** Every retained source field is mapped, preserved as an extension, or explicitly excluded with an owner-approved reason. No field is silently dropped. Every retained record and asset has a confirmed tenant before import.

## 1. Mapping conventions

### 1.1 Identity and provenance fields

These rules apply to every retained type:

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `_id` | `id` | string | Preserve exactly. Never regenerate during migration. Asset IDs follow the same rule. |
| `_type` | `sourceSchemaType` | string | Preserve for provenance; the native collection is fixed by the target table. Never overwrite the business field `sourceType` used by `moneyEntry`. |
| `_rev` | `sourceRev` | string | Preserve the Sanity revision as provenance. Do not use it as the native revision. Business versions such as `version`, `fromRevision`, and `toRevision` keep their own names. |
| `_createdAt` | `createdAt` | datetime | Preserve; normalize to UTC ISO-8601 only if the source is a valid timestamp. |
| `_updatedAt` | `updatedAt` | datetime | Preserve when present; absent for append-only records that never had one. |
| `_key` | `sourceKey` | string | Preserve inside array objects. Array order is always preserved. |
| `_weak` | `referenceWeak` | boolean | Preserve reference weakness metadata; never silently strengthen a weak reference. |
| Unknown field | `sourceExtensions` | object | Preserve under the field name in a typed extension object. Classify it for privacy; never expose it as a normal API field until reviewed. |

`tenantId` is not a normal copy field. Its source and registry rule are in §2. `companyId` is preserved as `legacyCompanyId`; it is **not** copied directly into `tenantId`. A registry alias may map `companyId` to a tenant, but string equality is not assumed.

### 1.2 References and assets

- A Sanity reference object `{ _ref, _type: "reference" }` becomes a native target ID: `counterparty` → `counterpartyContactId`, `linkedDecision` → `linkedDecisionId`.
- A reference array becomes an ordered `...Ids` array. Order and `_key` values are preserved.
- Native relation storage is `(tenantId, targetId)` with a composite foreign key. The field mapping records the target ID; the repository and database enforce the tenant pair.
- Dereferenced snapshots are not stored in the content row. Projections resolve references at read time.
- An image/file object preserves `alt`, `caption`, `hotspot`, `crop`, and reference metadata alongside `assetId`. The binary is handled by the asset baseline, not embedded in JSON. Tenancy, sharing, keys, deletion, and delivery follow the [asset tenancy and sharing policy](native-cms-asset-tenancy-sharing-policy.md).
- A weak reference remains weak and is reported separately from a required relation. A weak reference that does not resolve is not converted into a hard failure unless the target field is required by the native contract.

### 1.3 Dates, numbers, and enums

- `datetime` stays an ISO-8601 UTC string at the API boundary; storage uses a timestamp type. Do not shift a source timezone implicitly.
- `date` remains a calendar date (`YYYY-MM-DD`); do not convert it to midnight in a local timezone.
- Ordinary numbers remain JSON numbers. **Money fields** (`amountUsd`, `budgetUsd`, `economicsBudgetUsd`, `fromBudgetUsd`, `toBudgetUsd`) map to exact decimal values with two decimal places. More than two meaningful decimal places, NaN, infinity, or a non-numeric string blocks the record.
- Enums preserve the source string. A source value outside the native union is an unmapped field, not a silently coerced value. Approved aliases are listed in the per-type tables.
- A JSON string field (`featuresJson`, `definitionJson`, `stateJson`, `weightsJson`, `measurementsJson`, `decisionsJson`, `changeJson`, `previousJson`, `historyJson`, `questionFeedbackJson`, `sourcesJson`) must parse as JSON. Malformed JSON blocks the record; the raw string is retained in `sourceExtensions` for diagnosis.
- `null`, missing, and empty string are distinct. The mapping does not turn one into another except where the source schema requires a default and the owner records that rule.

### 1.4 Arrays, objects, and unknown fields

- Array order is preserved. Object keys are not lost; known keys are typed, unknown keys go to `sourceExtensions` at the same nesting level.
- A typed object (`approvalRecord`, `executionAudit`, `process`, `evaluation`, `reviewerNotes`, `prediction`, `verdict`, `outcome`, `metrics`, `externalSync`) maps field-by-field. A nested field that is absent stays absent; do not create empty objects.
- `sourceExtensions` is for preservation and later review, not an authorization or query surface. It is excluded from normal API projections until a field is promoted.
- A field that the native store legitimately regenerates must be excluded on **both** sides through a versioned projection. The mapping table must name the exclusion and the owner. No business, authority, audit, tenant, or reference field may be excluded merely to make parity pass.

### 1.5 Source fields with known semantic aliases

| Source shape | Native canonical shape | Rule |
|---|---|---|
| `entity.kind` (ontology) vs `entity.entityType` (Studio) | `entityType` | Map ontology values to the same vocabulary; preserve the original in `legacyKind`. |
| `department.purpose` vs ontology `description` | `description` | Prefer Studio `purpose`; preserve ontology text in `legacyDescription`. |
| `organization.mission` vs ontology `description` | `mission` | Preserve ontology text in `legacyDescription`. |
| `metric.value` vs ontology `currentValue` | `value` | Preserve ontology `currentValue` as `legacyCurrentValue`; preserve `targetValue` as `targetValue`. |
| `policy.effect = "review"` (ontology) | `require-approval` | Allowed only with owner approval; preserve `review` in `legacyEffect`. |
| `objective.status` variants | Canonical union | Preserve `blocked`/`abandoned`/`cancelled` as status strings until the owner approves an alias. |
| `workflow.definition` JSON vs typed process fields | Typed `states`/`transitions` plus `legacyDefinition` | If both exist, validate agreement; disagreement blocks the record. |
| `decision.proposal`/`outcome` legacy fields | Current decision fields plus `legacyProposal`/`legacyOutcome` | Do not discard the source shape. |
| `companyId` | `legacyCompanyId` | Tenant is assigned only through the registry in §2. |

### 1.6 Embedded objects and graph payloads

A table row covers the outermost source field. Embedded fields keep their source names unless a row says otherwise; the whole embedded object is preserved, not just the keys named in the rule.

- **Graph payloads:** `workflow.states`/`transitions`, `automationWorkflow.nodes`/`edges`, and `intentGraph.variables`/`edges` retain every nested key, array order, `_key`, and loop body. Known guard, transition, node, edge, and variable fields are validated; unknown nested keys go to `sourceExtensions` at that nesting level.
- **History and audit payloads:** `commitment.processHistory`, `draftedCommunication.processHistory`, `decision.processHistory`, `decision.policyChecks`, `decision.approvalRecord`, `decision.executionAudit`, and `decision.process` retain every entry and nested key. `decision.processHistory` is the exception that is projected into `qs_decision_events` rather than kept as an editable array.
- **Provider and evaluation payloads:** `contact.externalSync`, `scheduledItem.externalSync`, `shadowRecommendation.prediction`/`verdict`/`outcome`, and `review.metrics` retain every nested key. The review counts are `pendingDecisionsCount`, `dueCommitmentsCount`, `waitingOnOthersCount`, `upcomingCount`, and `staleItemsCount`; a missing count stays missing rather than becoming zero.
- A nested reference object still becomes a typed target ID under the rules in §1.2. A nested free-form string that contains an ID is not silently promoted to a relation.

## 2. Tenant ownership registry

### 2.1 Registry records

The registry is a separate, reviewed control-plane dataset. It is not inferred from the exporter environment.

| Registry object | Fields | Purpose |
|---|---|---|
| `tenant` | `tenantId`, `displayName`, `status` (`active`, `suspended`, `closed`), `legacyCompanyIds[]`, `retentionPolicyId`, `createdAt`, `owner`, `evidenceRef` | Canonical tenant list. `tenantId` is opaque, stable, case-sensitive, and contains no personal data. |
| `tenant_alias` | `aliasType` (`companyId`, `legacyTenantId`, `other`), `aliasValue`, `tenantId`, `status` (`approved`, `rejected`), `approvedBy`, `approvedAt`, `evidenceRef` | Explicit mapping for legacy identifiers. No implicit normalization. |
| `principal_tenant` | `principalId`, `issuer`, `subject`, `tenantId`, `status`, `validFrom`, `validTo`, `evidenceRef` | Authenticated principal → tenant binding used by C2. |
| `record_ownership` | `sourceType`, `sourceId`, `tenantId`, `basis`, `status`, `confidence`, `evidenceRef`, `approvedBy`, `approvedAt` | One row per retained source document or an owner-approved type-wide rule. |
| `asset_ownership` | `assetId`, `tenantId`, `mode` (`exclusive`, `shared`), `grantScope` (`tenant`, `global`), `status` (`confirmed`, `revoked`, `rejected`), `decisionRef`, `approvedBy`, `approvedAt` | Asset tenancy and grants, including shared assets. Only `confirmed` grants count; reference counts are derived from `asset_reference`, not ownership. |
| `ownership_manifest` | `baselineId`, counts by status, unresolved count, aliases used, digest, approver, date | Redacted acceptance record; no private IDs or tenant lists in the public copy. |

`record_ownership.status` is one of:

- `confirmed` — approved for import;
- `candidate` — supported by reference closure but not owner-approved;
- `ambiguous` — multiple tenants or conflicting evidence;
- `unresolved` — no tenant evidence;
- `global` — owner-approved shared/global asset only, never a content record;
- `retired` — owner-approved exclusion, with evidence.

Only `confirmed` content ownership is importable. `candidate`, `ambiguous`, and `unresolved` block the record. A type-wide rule is allowed only when the owner names the type, the record set, the basis, and the evidence; it is not a default tenant.

### 2.2 Resolution order

For each retained record, resolve ownership in this order:

1. **Validated explicit tenant.** A source `tenantId` is used only if the tenant exists in the registry and an approved alias/record rule confirms it. A source field alone is not sufficient if it contradicts the record mapping.
2. **Approved record mapping.** `record_ownership` with status `confirmed` and an owner/approver.
3. **Approved legacy alias.** `companyId` or another alias through `tenant_alias`; preserve the legacy value.
4. **Reference closure candidate.** If every same-tenant reference agrees, record a `candidate`; it becomes `confirmed` only after owner approval. Reference agreement is evidence, not authority.
5. **Owner-approved type/seed rule.** Permitted for a declared fixture or a declared single-tenant dataset with evidence. It must be explicit and bounded, never a global default.
6. **No fallback.** `QUICKSILVER_TENANT_ID`, a process environment, a default tenant, an empty string, a slug, or a display name never assigns ownership.

If two tenants share a business key or asset, the record is `ambiguous` until the owner decides. Colliding native IDs are tested with two tenants; a shared asset is recorded as `shared` with an access policy, not duplicated silently.

### 2.3 Tenant ownership matrix

| Source type | Current tenant signal | Pre-C1 ownership action |
|---|---|---|
| `organization` | None | Assign one root organization per tenant; owner confirms every root. |
| `department` | `companyId` | Approve `companyId` aliases; preserve `legacyCompanyId`; confirm department rows. |
| `entity` | None | Owner mapping by entity; do not infer from department alone. |
| `capability` | None | Assign to the owning tenant; shared catalog entries require an owner-approved rule. |
| `policy` | None | Assign to the tenant whose kernel uses it; cross-tenant policy reuse is a copy, not a relation. |
| `objective` | None | Assign from owner/organization evidence; reference closure is candidate only. |
| `workflow` | None | Assign to the tenant whose process engine loads it. |
| `automationWorkflow` | `tenantId` | Validate against the registry; reject unknown tenant IDs. |
| `workflowPublicationHead` | `tenantId` | Validate; require exactly one head per tenant/graph. |
| `evidence` | None | Assign by objective/metric/decision closure plus owner approval. |
| `decision` | None | Assign from requester/tenant evidence; a foreign decision ID is not a tenant source. |
| `metric` | None | Assign by objective/department evidence; owner confirms. |
| `intentGraph` | None | Assign to the Aura tenant; no global graph. |
| `intentLedgerEntry` | `companyId` | Approve the company alias; preserve the legacy value; keep the chain tenant-local. |
| `agentDefinition` | `tenantId` | Validate; agent/version identity is tenant-qualified. |
| `agentPublicationHead` | `tenantId` | Validate; one head per tenant/agent. |
| `commitment` | None | Assign to the operator tenant; contact/decision references are candidate evidence only. |
| `contact` | None | Assign to the operator tenant; shared contacts require an explicit decision. |
| `scheduledItem` | None | Assign to the operator tenant; linked records must agree. |
| `draftedCommunication` | None | Assign to the operator tenant; recipient contact must agree. |
| `departmentExecutionAudit` | `companyId` | Approve alias; preserve legacy value; confirm the department/run tenant. |
| `workflowPublicationAudit` | `tenantId` | Validate against the workflow head's tenant. |
| `workflowExecution` | `tenantId` | Validate against the workflow's tenant. |
| `evaluationRecord` | None | Assign by requester/run/agent evidence; owner confirms. |
| `shadowRecommendation` | None | Assign by intent/department evidence; owner confirms. |
| `auraVerdictLearner` | None | Assign by intent; learner state is tenant-local. |
| `moneyEntry` | None | Assign by run/experiment/decision evidence; owner confirms; chain is tenant-local. |
| `experimentRecord` | None | Assign by run/proposedBy evidence; owner confirms. |
| `contentReview` | None | Assign by experiment/run evidence; owner confirms. |
| `agentPublicationAudit` | `tenantId` | Validate against the agent definition's tenant. |
| `authorizationDecisionAudit` | `tenantId` | Validate; an authorization audit without a confirmed tenant blocks. |
| `telemetryTraceSpan` | `tenantId` | Validate; metadata-only spans remain tenant-scoped. |
| `review` | None | Assign to the operator tenant; generated snapshot references must agree. |
| `oidcLoginTransaction`, `oidcWebSession` | Auth plane | Excluded from CMS ownership; keep in the auth adapter. |
| `playbook` | None | Retained 2026-11-19: assign ownership like other content; resolves in the C0 ownership manifest. |

### 2.4 Ownership gate before C1

The ownership registry must produce a redacted manifest under the [C0 tenant ownership resolution and redacted manifest procedure](native-cms-c0-ownership-resolution-manifest.md). It shows:

- retained document count by type and ownership status;
- zero `ambiguous` and zero `unresolved` content records;
- every `candidate` resolved to `confirmed` or excluded with an owner decision;
- every shared asset listed with its tenant set and policy;
- every legacy alias approved by a named owner;
- principal-to-tenant bindings for the authentication path;
- a digest over the private ownership manifest.

A type-wide rule must list the source type and the exact predicate. “Single tenant” is not a predicate unless the owner records the dataset/project scope and evidence.

## 3. Field-level mapping: native content collections

The identity fields in §1.1 apply to every table and are not repeated. Native property names preserve the source name unless this table states a rename. `ref` means a same-tenant target ID; `ref[]` means an ordered ID array.

### 3.1 `organization` → `qs_organizations`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `name` | `name` | string | Preserve. |
| ontology `slug` | `slug` | string | Preserve; unique per tenant; do not regenerate from a translated name. |
| `mission` | `mission` | text | Preserve. |
| ontology `description` | `legacyDescription` | text | Preserve; no overwrite of `mission`. |
| `objectives` | `objectiveIds` | ref[] | Ordered; same tenant. |
| `departments` | `departmentIds` | ref[] | Ordered; same tenant. |
| `policies` | `policyIds` | ref[] | Ordered; same tenant. |
| `resources` | `resourceEntityIds` | ref[] | Ordered; same tenant. |

### 3.2 `department` → `qs_departments`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `name` | `name` | string | Preserve. |
| `purpose` | `description` | text | Prefer Studio `purpose`. |
| ontology `description` | `description` when `purpose` is absent; otherwise `legacyDescription` | text | Preserve; never overwrite `purpose`. |
| `parentDepartment` | `parentDepartmentId` | ref | Same tenant; no cycle. |
| `leader` | `leaderEntityId` | ref | Same tenant. |
| `members` | `memberEntityIds` | ref[] | Ordered; same tenant. |
| ontology `entities` | `memberEntityIds` | ref[] | Inverse of `entity.departments`; deduplicate against `members`, preserving order. |
| `capabilities` | `capabilityIds` | ref[] | Ordered; same tenant. |
| `objectives` | `objectiveIds` | ref[] | Ordered; same tenant. |
| ontology `organization` | `organizationId` | ref | Same tenant. |
| ontology `childDepartments` | `childDepartmentIds` | ref[] | Derived inverse of `parentDepartment`; verify against parent edges. |
| `workflows` (ontology) | `workflowIds` | ref[] | Ordered; same tenant. |
| `metrics` (ontology) | `metricIds` | ref[] | Ordered; same tenant. |
| `companyId` | `legacyCompanyId` | string | Preserve; tenant only through `tenant_alias` (§2). |
| `economicsRunId` | `economicsRunId` | string | Preserve. |
| `economicsDepartmentId` | `economicsDepartmentId` | string | Preserve. |
| `economicsStatus` | `economicsStatus` | enum `active`/`retired` | Preserve. |
| `economicsBudgetUsd` | `economicsBudgetUsd` | decimal(2) | Exact money mapping. |
| `economicsRevision` | `economicsRevision` | integer | Preserve the source economics revision; native record revision is separate. |
| `economicsProposalId` | `economicsProposalId` | string | Preserve. |
| `economicsApprovalDigest` | `economicsApprovalDigest` | string | Preserve; validate digest shape. |
| `economicsEvidenceRefs` | `economicsEvidenceRefs` | string[] | Preserve order. |

### 3.3 `entity` → `qs_entities`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `name` | `name` | string | Preserve. |
| `entityType` | `entityType` | enum | Canonical vocabulary; preserve unknown values as `sourceExtensions` and block promotion. |
| ontology `kind` | `legacyKind` | string | Preserve; map to `entityType` only with owner-approved vocabulary. |
| `externalId` | `externalId` | string? | Preserve. |
| `metadata` | `metadata` | JSON | Preserve nested shape; classify unknown keys. |
| `capabilities` | `capabilityIds` | ref[] | Ordered; same tenant. |
| `permissions` | `permissionPolicyIds` | ref[] | Ordered; same tenant. |
| `constraints` | `constraintPolicyIds` | ref[] | Ordered; same tenant. |
| `reportsTo` | `reportsToEntityId` | ref | Same tenant; no self/cycle. |
| `department` | `departmentId` | ref | Same tenant. |
| ontology `departments` | `departmentIds` | ref[] | Ordered; same tenant; reconcile with the singular Studio relation before import. |
| `availability` | `availability` | string? | Preserve. |
| `riskProfile` | `riskProfile` | number 0–5 | Preserve; out-of-range blocks. |
| `costProfile` | `costProfile` | string? | Preserve. |

### 3.4 `capability` → `qs_capabilities`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `name` | `name` | string | Preserve. |
| `description` | `description` | text | Preserve. |
| `requiredSkills` | `requiredSkills` | string[] | Preserve order. |
| ontology `resource` | `legacyResource` | string? | Preserve. |
| ontology `action` | `legacyAction` | string? | Preserve. |
| `riskLevel` | `riskLevel` | number 0–5 | Preserve; out-of-range blocks. |
| `authorizedEntities` | `authorizedEntityIds` | ref[] | Ordered; same tenant. |
| ontology `entities` | `authorizedEntityIds` | ref[] | Inverse of `entity.capabilities`; merge with `authorizedEntities` without duplication. |
| `policyScopes` | `policyScopes` | string[] | Preserve order. |
| ontology `policies` | `policyIds` | ref[] | Ordered; same tenant; governing policies. |
| `inherits` | `inheritsCapabilityIds` | ref[] | Ordered; same tenant; graph validation. |
| `requires` | `requiresCapabilityIds` | ref[] | Ordered; same tenant; graph validation. |
| `conflictsWith` | `conflictsWithCapabilityIds` | ref[] | Ordered; same tenant; graph validation. |
| `riskMultiplier` | `riskMultiplier` | number ≥1? | Preserve; invalid values block. |
| `requiredTools` | `requiredTools` | string[] | Preserve order. |

### 3.5 `policy` → `qs_policies`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `name` | `name` | string | Preserve. |
| ontology `description` | `description` | text | Preserve. |
| `scope` | `scope` | string | Preserve dotted scope; no silent widening. |
| `priority` | `priority` | integer | Preserve. |
| `rules` | `rules` | JSON | Preserve source array/object; validate against the native policy shape. |
| `effect` | `effect` | enum | Canonical `allow`/`require-approval`/`deny`; `review` requires owner-approved alias and `legacyEffect`. |
| `maxRiskLevel` | `maxRiskLevel` | integer 0–5 | Preserve. |
| `whenAll` | `whenAll` | JSON[] | Preserve order and structured guards; never evaluate strings. |
| `effectiveDate` | `effectiveDate` | date | Preserve. |
| `expirationDate` | `expirationDate` | date | Preserve. |
| `supersedes` | `supersedesPolicyIds` | ref[] | Ordered; same tenant/lineage. |
| `lineageId` | `lineageId` | string | Preserve. |
| `version` | `version` | integer | Preserve as the policy lineage version; native record revision is separate. |
| `appliesTo` | `appliesToEntityIds` | ref[] | Ordered; same tenant. |
| `approvalRequirements` | `approvalEntityIds` | ref[] | Ordered; same tenant. |
| `organization` (ontology) | `organizationId` | ref | Same tenant. |
| `capabilities` (ontology) | `capabilityIds` | ref[] | Ordered; same tenant. |

### 3.6 `objective` → `qs_objectives`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `name` | `name` | string | Preserve; ontology `title` → `legacyTitle`. |
| `description` | `description` | text | Preserve. |
| `owner` | `ownerEntityId` | ref | Same tenant. |
| `priority` | `priority` | number 0–10 | Preserve. |
| `deadline` | `deadline` | date | Preserve. |
| `constraints` | `constraints` | string[] | Preserve order. |
| `successMetrics` | `successMetrics` | string[] | Preserve order. |
| `budget` | `budget` | JSON | Preserve `amount` as decimal and `currency`; do not flatten currency. |
| `status` | `status` | enum | Preserve canonical values; unapproved aliases remain legacy. |
| `organization` | `organizationId` | ref | Same tenant. |
| `department` | `departmentId` | ref | Same tenant. |
| `parentObjective` | `parentObjectiveId` | ref | Same tenant; no cycle. |
| `childObjectives` | `childObjectiveIds` | ref[] | Derived inverse; verify against parent edges. |
| `workflows` | `workflowIds` | ref[] | Ordered; same tenant. |
| `evidence` | `evidenceIds` | ref[] | Ordered; same tenant. |
| `decisions` | `decisionIds` | ref[] | Ordered; same tenant. |
| `metrics` (ontology/relation) | `metricIds` | ref[] | Ordered; same tenant. |

### 3.7 `workflow` → `qs_workflows`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `name` | `name` | string | Preserve. |
| ontology `description` | `description` | text | Preserve. |
| `version` | `version` | integer | Preserve as the process definition version; native record revision is separate. |
| `trigger` | `trigger` | string? | Preserve. |
| `initialState` | `initialState` | string | Preserve. |
| `states` | `states` | JSON[] | Preserve order and terminal flags. |
| `transitions` | `transitions` | JSON[] | Preserve order, `guardAll`, `guardAny`, `automatic`, and `requiresHumanApproval`. |
| `requiredCapabilities` | `requiredCapabilityIds` | ref[] | Ordered; same tenant. |
| `approvalRequirements` | `approvalEntityIds` | ref[] | Ordered; same tenant. |
| `failureHandlers` | `failureHandlers` | string[] | Preserve order. |
| `rollbackProcedure` | `rollbackProcedure` | text | Preserve. |
| `definition` (ontology) | `legacyDefinition` | JSON | Preserve; validate agreement with typed states/transitions. |
| `status` (ontology) | `status` | enum | Preserve canonical values. |
| `department` | `departmentId` | ref | Same tenant. |
| `objective` | `objectiveId` | ref | Same tenant. |
| `decisions` | `decisionIds` | ref[] | Derived inverse; verify against decision process links. |

### 3.8 `automationWorkflow` → `qs_automation_workflows`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `name` | `name` | string | Preserve. |
| `graphId` | `graphId` | string | Preserve; unique per tenant. |
| `schemaVersion` | `schemaVersion` | integer | Preserve. |
| `version` | `version` | integer | Preserve; version row is immutable after publish. |
| `lifecycle` | `lifecycle` | enum | Preserve `draft`/`review`/`active`/`archived`. |
| `graphDigest` | `graphDigest` | string | Preserve; validate against graph. |
| `authoredBy` | `authoredBy` | string | Preserve. |
| `createdAt` | `createdAt` | datetime | Preserve. |
| `reviewedBy` | `reviewedBy` | string? | Preserve. |
| `reviewNote` | `reviewNote` | text? | Preserve. |
| `reviewedAt` | `reviewedAt` | datetime? | Preserve. |
| `publishedAt` | `publishedAt` | datetime? | Preserve. |
| `deprecatedAt` | `deprecatedAt` | datetime? | Preserve. |
| `rollbackOfVersion` | `rollbackOfVersion` | integer? | Preserve. |
| `entryNodeId` | `entryNodeId` | string | Preserve. |
| `nodes` | `nodes` | JSON[] | Preserve order, node `_key`, loop body shape. |
| `edges` | `edges` | JSON[] | Preserve order, edge `_key`, branch. |

### 3.9 `workflowPublicationHead` → `qs_workflow_publication_heads`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `graphId` | `graphId` | string | Preserve; same tenant. |
| `activeVersion` | `activeVersion` | integer? | Preserve; must resolve to a published workflow version. |
| `updatedAt` | `updatedAt` | datetime | Preserve. |
| — | `casRevision` | integer | Native-only concurrency token; not sourced. |

### 3.10 `evidence` → `qs_evidence`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `title` | `title` | string | Preserve. |
| `type` / ontology `kind` | `type` | enum | Canonical union; preserve legacy value if it cannot map. |
| `source` | `source` | string? | Preserve. |
| `claim` | `claim` | text? | Preserve. |
| `confidence` | `confidence` | number 0–1? | Preserve; out-of-range blocks. |
| `effectiveDate` | `effectiveDate` | date? | Preserve. |
| ontology `observedAt` | `observedAt` | datetime? | Preserve; do not substitute the import timestamp or `effectiveDate`. |
| `content` (ontology) | `content` | JSON? | Preserve. |
| `objective` | `objectiveId` | ref | Same tenant. |
| `metric` | `metricId` | ref | Same tenant. |
| `relatedEntities` | `relatedEntityIds` | ref[] | Ordered; same tenant. |
| `supports` | `supportsObjectiveIds` | ref[] | Ordered; same tenant. |
| `contradicts` | `contradictsEvidenceIds` | ref[] | Ordered; same tenant. |
| `decisions` | `decisionIds` | ref[] | Ordered; same tenant. |

### 3.11 `decision` → `qs_decisions`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `question` | `question` | text? | Preserve. |
| ontology `title` | `question` when `question` is absent; otherwise `legacyTitle` | text | Preserve the ontology title; never discard it. |
| `context` | `context` | JSON[] | Preserve target type/ID; same-tenant typed context; no free IDs. |
| `candidateActions` | `candidateActions` | JSON[] | Preserve order; actor/capability references resolve same-tenant. |
| `selectedAction` | `selectedAction` | string? | Preserve. |
| `reasoningSummary` | `reasoningSummary` | text? | Preserve; no chain-of-thought. |
| `evidence` | `evidenceIds` | ref[] | Ordered; same tenant. |
| `constraints` | `constraints` | string[] | Preserve order. |
| `policyResolutions` | `policyResolutions` | string[] | Preserve order. |
| `policyChecks` | `policyChecks` | JSON[] | Preserve policy refs/results/reasons; same tenant. |
| `riskLevel` | `riskLevel` | number 0–5? | Preserve. |
| `requiredApproval` | `requiredApproval` | boolean? | Preserve. |
| `policySnapshotVersion` | `policySnapshotVersion` | string? | Preserve; validate digest. |
| `approvalRecord` | `approvalRecord` | JSON? | Preserve all nested fields; approval remains an authority artifact. |
| `executionAudit` | `executionAudit` | JSON? | Preserve all nested fields. |
| `safetyDecision` | `safetyDecision` | enum? | Preserve `ALLOW`/`BLOCK`/`ESCALATE`. |
| `evaluation` | `evaluation` | JSON? | Preserve signals; no private reasoning. |
| `reviewerNotes` | `reviewerNotes` | JSON? | Preserve advisory fields. |
| `status` | `status` | enum | Preserve; canonical union; no coercion. |
| `kind` | `kind` | enum | Preserve `plan`/`rollback`. |
| `faultInjection` | `faultInjection` | enum? | Preserve test-only marker; exclude from production analytics. |
| `kernelRecommendation` | `kernelRecommendation` | enum? | Preserve. |
| `kernelAuthorized` | `kernelAuthorized` | boolean? | Preserve. |
| `rollbackOf` | `rollbackOfDecisionId` | ref? | Same tenant; no rollback-of-rollback. |
| `observedDeviation` | `observedDeviation` | boolean? | Preserve. |
| ontology `objective` | `objectiveId` | ref? | Same tenant. |
| ontology `workflow` | `workflowId` | ref? | Same tenant. |
| `process` | `process` | JSON? | Preserve definition/version/revision. |
| `processHistory` | `decisionEvents` | event[] | Do not store as an editable array. Append each entry to `qs_decision_events`; preserve `_key` as source key. |
| `requestedBy` | `requestedBy` | string? | Preserve. |
| `proposedBy` | `proposedBy` | string? | Preserve. |
| `approvedBy` | `approvedByEntityId` | ref? | Same tenant. |
| `createdAt` | `createdAt` | datetime? | Preserve. |
| `executedAt` | `executedAt` | datetime? | Preserve. |
| ontology `proposal` | `legacyProposal` | JSON | Preserve. |
| ontology `outcome` | `legacyOutcome` | JSON | Preserve. |

### 3.12 `metric` → `qs_metrics`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `name` | `name` | string | Preserve. |
| `unit` | `unit` | string? | Preserve. |
| `value` | `value` | decimal | Preserve exact numeric value; source `currentValue` accepted as legacy alias. |
| `baseline` | `baseline` | number? | Preserve. |
| ontology `targetValue` | `targetValue` | number? | Preserve. |
| `direction` | `direction` | enum | Preserve `lower-better`/`higher-better`. |
| `objective` | `objectiveId` | ref | Same tenant. |
| ontology `department` | `departmentId` | ref? | Same tenant. |
| `relatedDecision` | `relatedDecisionId` | ref? | Same tenant. |
| `observedAt` / `updatedAt` | `observedAt` | datetime? | Preserve source timestamp; do not replace with import time. |
| `faultInjection` | `faultInjection` | enum? | Preserve test-only marker; exclude production rollups. |
| ontology `evidence` | `evidenceIds` | ref[] | Derived inverse; verify. |

### 3.13 `intentGraph` → `qs_intent_graphs`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `graphId` | `graphId` | string | Preserve; unique per tenant. |
| `objective` | `objective` | text | Preserve. |
| `mode` | `mode` | enum | Preserve genesis/onboard/operate. |
| `autonomyDepth` | `autonomyDepth` | enum | Preserve. |
| `requestedBy` | `requestedBy` | string | Preserve. |
| `createdAt` | `createdAt` | datetime | Preserve. |
| `variables` | `variables` | JSON[] | Preserve order and provenance/confidence/sources. |
| `edges` | `edges` | JSON[] | Preserve order and relation. |
| `historyJson` | `history` | JSON[] | Parse and preserve order; append-only audit. |
| `questionFeedbackJson` | `questionFeedback` | JSON[] | Parse and preserve order; append-only. |

### 3.14 `intentLedgerEntry` → `qs_intent_ledger_entries`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `companyId` | `legacyCompanyId` | string | Preserve; tenant via registry. |
| `seq` | `seq` | integer | Preserve; unique per tenant/chain. |
| `at` | `at` | datetime | Preserve. |
| `actorId` | `actorId` | string | Preserve. |
| `actorRole` | `actorRole` | enum | Preserve provider/admin. |
| `changeType` | `changeType` | enum | Preserve; unknown values block. |
| `changeJson` | `change` | JSON | Parse; preserve exactly. |
| `previousJson` | `previous` | JSON | Parse; preserve exactly. |
| `reason` | `reason` | string? | Preserve. |
| `prevHash` | `prevHash` | string | Preserve. |
| `hash` | `hash` | string | Preserve; verify chain. |
| `signature` | `signature` | string? | Preserve. |

### 3.15 `agentDefinition` → `qs_agent_definitions`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `agentId` | `agentId` | string | Preserve; regex and tenant-qualified identity. |
| `displayName` | `displayName` | string | Preserve. |
| `description` | `description` | text | Preserve. |
| `version` | `version` | integer | Preserve; unique per tenant/agent. |
| `lifecycle` | `lifecycle` | enum | Preserve draft/review/active/archived. |
| `manifest` | `manifest` | JSON | Preserve; validate manifest and digest. |
| `definitionDigest` | `definitionDigest` | string | Preserve; validate. |
| `authoredBy` | `authoredBy` | string | Preserve. |
| `createdAt` | `createdAt` | datetime | Preserve. |
| `reviewedBy` | `reviewedBy` | string? | Preserve. |
| `reviewNote` | `reviewNote` | text? | Preserve. |
| `reviewedAt` | `reviewedAt` | datetime? | Preserve. |
| `publishedAt` | `publishedAt` | datetime? | Preserve. |
| `rollbackFromVersion` | `rollbackFromVersion` | integer? | Preserve. |
| `rollbackFromDigest` | `rollbackFromDigest` | string? | Preserve. |

### 3.16 `agentPublicationHead` → `qs_agent_publication_heads`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `agentId` | `agentId` | string | Preserve; same tenant. |
| `activeVersion` | `activeVersion` | integer? | Preserve; must resolve to an active definition. |
| `updatedAt` | `updatedAt` | datetime | Preserve. |
| — | `casRevision` | integer | Native-only concurrency token. |

### 3.17 `commitment` → `qs_commitments`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `title` | `title` | string | Preserve. |
| `direction` | `direction` | enum | Preserve i-owe/they-owe. |
| `counterparty` | `counterpartyContactId` | ref? | Same tenant. |
| `dueAt` | `dueAt` | datetime? | Preserve. |
| `checkBackAt` | `checkBackAt` | datetime? | Preserve. |
| `status` | `status` | enum | Preserve open/done/deferred/dropped. |
| `deferredUntil` | `deferredUntil` | datetime? | Preserve. |
| `context` | `context` | text | Preserve. |
| `linkedDecision` | `linkedDecisionId` | ref? | Same tenant. |
| `createdBy` | `createdBy` | string? | Preserve. |
| `createdAt` | `createdAt` | datetime? | Preserve. |
| `processHistory` | `processHistory` | JSON[] | Preserve order and entries; append-only domain events. |

### 3.18 `contact` → `qs_contacts`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `name` | `name` | string | Preserve. |
| `kind` | `kind` | enum | Preserve person/organization. |
| `email` | `email` | string? | Preserve; classify personal data. |
| `notes` | `notes` | text? | Preserve; classify personal data. |
| `checkBackCadence` | `checkBackCadence` | string? | Preserve cron expression; do not evaluate. |
| `lastInteractionAt` | `lastInteractionAt` | datetime? | Preserve. |
| `status` | `status` | enum | Preserve active/archived. |
| `externalSync` | `externalSync` | JSON? | Preserve provider/externalId/syncedAt; optional. |

### 3.19 `scheduledItem` → `qs_scheduled_items`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `title` | `title` | string | Preserve. |
| `kind` | `kind` | enum | Preserve reminder/review-block/meeting/deadline/check-back. |
| `startsAt` | `startsAt` | datetime | Preserve. |
| `endsAt` | `endsAt` | datetime? | Preserve. |
| `allDay` | `allDay` | boolean | Preserve. |
| `recurrence` | `recurrence` | string? | Preserve; do not evaluate. |
| `linkedCommitment` | `linkedCommitmentId` | ref? | Same tenant. |
| `linkedDecision` | `linkedDecisionId` | ref? | Same tenant. |
| `linkedContact` | `linkedContactId` | ref? | Same tenant. |
| `notes` | `notes` | text? | Preserve. |
| `status` | `status` | enum | Preserve upcoming/done/cancelled. |
| `createdBy` | `createdBy` | string? | Preserve. |
| `createdAt` | `createdAt` | datetime? | Preserve. |
| `externalSync` | `externalSync` | JSON? | Preserve provider/externalId/syncedAt/etag. |

### 3.20 `draftedCommunication` → `qs_drafted_communications`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `kind` | `kind` | enum | Preserve email/message/note. |
| `to` | `recipientContactId` | ref | Same tenant. |
| `subject` | `subject` | string? | Preserve. |
| `body` | `body` | text | Preserve; classification depends on content. |
| `linkedCommitment` | `linkedCommitmentId` | ref? | Same tenant. |
| `linkedDecision` | `linkedDecisionId` | ref? | Same tenant. |
| `status` | `status` | enum | Preserve draft/approved/sent/cancelled. |
| `deliveryChannel` | `deliveryChannel` | enum? | Preserve email/slack/discord/telegram. |
| `sentAt` | `sentAt` | datetime? | Preserve. |
| `createdBy` | `createdBy` | string? | Preserve. |
| `createdAt` | `createdAt` | datetime? | Preserve. |
| `processHistory` | `processHistory` | JSON[] | Preserve order; no rewrite of history. |

## 4. Field-level mapping: derived/audit stores

### 4.1 `departmentExecutionAudit` → `qs_department_execution_audits`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `proposalId` | `proposalId` | string | Preserve. |
| `proposalDigest` | `proposalDigest` | string | Preserve; validate digest. |
| `actionId` | `actionId` | string | Preserve. |
| `actionDigest` | `actionDigest` | string | Preserve; validate digest. |
| `approvalDigest` | `approvalDigest` | string | Preserve; validate digest. |
| `companyId` | `legacyCompanyId` | string | Preserve; tenant via registry. |
| `runId` | `runId` | string | Preserve. |
| `departmentId` | `departmentId` | string | Preserve; same tenant. |
| `action` | `action` | enum | Preserve spawn/fund/shrink/retire. |
| `fromStatus` | `fromStatus` | enum? | Preserve active/retired. |
| `toStatus` | `toStatus` | enum | Preserve active/retired. |
| `fromBudgetUsd` | `fromBudgetUsd` | decimal(2) | Exact money. |
| `toBudgetUsd` | `toBudgetUsd` | decimal(2) | Exact money. |
| `fromRevision` | `fromRevision` | integer | Preserve the source department revision. |
| `toRevision` | `toRevision` | integer | Preserve the source department revision. |
| `approvedBy` | `approvedBy` | string | Preserve. |
| `executedAt` | `executedAt` | datetime | Preserve. |

### 4.2 `workflowPublicationAudit` → `qs_workflow_publication_audits`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `event` | `event` | enum | Preserve known events; unknown blocks. |
| `graphId` | `graphId` | string | Preserve. |
| `version` | `version` | integer | Preserve as the publication event's target version. |
| `actorId` | `actorId` | string | Preserve. |
| `at` | `at` | datetime | Preserve. |
| `graphDigest` | `graphDigest` | string | Preserve; validate. |
| `detail` | `detail` | string? | Preserve. |

### 4.3 `workflowExecution` → `qs_workflow_executions`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `runId` | `runId` | string | Preserve; unique per tenant. |
| `workflowId` | `workflowId` | string | Preserve; same tenant. |
| `version` | `version` | integer | Preserve as the executed definition version. |
| `digest` | `digest` | string | Preserve; validate. |
| `requestedBy` | `requestedBy` | string | Preserve. |
| `status` | `status` | enum | Preserve succeeded/blocked/failed. |
| `startedAt` | `startedAt` | datetime | Preserve. |
| `completedAt` | `completedAt` | datetime | Preserve. |
| `durationMs` | `durationMs` | integer | Preserve. |
| `evaluationCount` | `evaluationCount` | integer | Preserve. |

### 4.4 `evaluationRecord` → `qs_evaluation_records`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `source` | `source` | enum | Preserve query/workflow-run/business-agent. |
| `agentId` | `agentId` | string? | Preserve. |
| `taskType` | `taskType` | string? | Preserve. |
| `modelId` | `modelId` | string? | Preserve. |
| `subject` | `subject` | text? | Preserve; truncation rule stays source-owned. |
| `requestedBy` | `requestedBy` | string? | Preserve. |
| `runId` / `nodeId` | `runId`, `nodeId` | string? | Preserve. |
| `reasoningScore` | `reasoningScore` | number? | Preserve. |
| `hallucinationRisk` / `brittleness` | same | enum? | Preserve. |
| `safetyDecision` | `safetyDecision` | enum? | Preserve ALLOW/ESCALATE/BLOCK. |
| `issues` / `corrections` | same | string[] | Preserve order. |
| `createdAt` | `createdAt` | datetime? | Preserve. |

### 4.5 `shadowRecommendation` → `qs_shadow_recommendations`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `intentId` | `intentId` | string | Preserve; tenant-local. |
| `recId` | `recId` | string | Preserve. |
| `seq` | `seq` | integer? | Preserve. |
| `department` | `department` | string? | Preserve. |
| `description` | `description` | text? | Preserve. |
| `proposedAt` | `proposedAt` | datetime? | Preserve. |
| `source` | `source` | enum? | Preserve human/agent. |
| `kernelRecommendation` | `kernelRecommendation` | enum? | Preserve. |
| `kernelRiskLevel` | `kernelRiskLevel` | number? | Preserve. |
| `executed` | `executed` | boolean | Preserve; must remain false for shadow records. |
| `featuresJson` | `features` | JSON? | Parse and preserve. |
| `prediction` | `prediction` | JSON? | Preserve accept/observations/model. |
| `verdict` | `verdict` | JSON? | Preserve value/by/at/note as an append-only stamp. |
| `outcome` | `outcome` | JSON? | Preserve value/by/at/note. |

### 4.6 `auraVerdictLearner` → `qs_aura_verdict_learners`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `intentId` | `intentId` | string | Preserve; unique per tenant. |
| `provenance` | `provenance` | enum | Must be `AGENT_INFERRED`; otherwise block. |
| `observations` | `observations` | integer? | Preserve. |
| `weightsJson` | `weights` | JSON? | Parse and preserve. |
| `stateJson` | `state` | JSON? | Parse and preserve. |

### 4.7 `moneyEntry` → `qs_money_entries`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `runId` | `runId` | string | Preserve; chain key. |
| `seq` | `seq` | integer | Preserve; unique per tenant/run. |
| `kind` | `kind` | enum | Preserve spend/compute/revenue/refund. |
| `amountUsd` | `amountUsd` | decimal(2) | Exact money; preserve sign. |
| `category` | `category` | string? | Preserve. |
| `description` | `description` | string? | Preserve. |
| `experimentId` | `experimentId` | string? | Preserve. |
| `sourceType` | `sourceType` | enum? | Preserve. |
| `sourceRef` | `sourceRef` | string? | Preserve. |
| `spendDecisionId` | `spendDecisionId` | string? | Preserve; not a cross-tenant ref. |
| `spendRecommendation` | `spendRecommendation` | enum? | Preserve. |
| `spendRiskLevel` | `spendRiskLevel` | number? | Preserve. |
| `spendReasons` | `spendReasons` | string[] | Preserve order. |
| `spendConfirmedBy` | `spendConfirmedBy` | string? | Preserve. |
| `spendConfirmedAt` | `spendConfirmedAt` | datetime? | Preserve. |
| `occurredAt` | `occurredAt` | datetime? | Preserve. |
| `recordedAt` | `recordedAt` | datetime? | Preserve. |
| `recordedBy` | `recordedBy` | string? | Preserve. |
| `prevHash` / `hash` | same | string | Preserve and verify chain. |

### 4.8 `experimentRecord` → `qs_experiment_records`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `runId` | `runId` | string | Preserve. |
| `experimentId` | `experimentId` | string | Preserve; unique per run/tenant. |
| `position` | `position` | number? | Preserve. |
| `status` | `status` | enum? | Preserve. |
| `hypothesis` | `hypothesis` | text? | Preserve. |
| `playbookId` | `playbookId` | string? | Preserve only; FK only if `playbook` is retained. |
| `budgetUsd` | `budgetUsd` | decimal(2)? | Exact money. |
| `durationDays` | `durationDays` | number? | Preserve. |
| `customerFacing` | `customerFacing` | boolean? | Preserve. |
| `proposedBy` | `proposedBy` | string? | Preserve. |
| `definitionJson` | `definition` | JSON? | Parse and preserve. |
| `digest` | `digest` | string? | Preserve; validate. |
| `startedAt` / `startedBy` | same | datetime?/string? | Preserve. |
| `endsAt` | `endsAt` | datetime? | Preserve. |
| `measurementsJson` | `measurements` | JSON? | Parse; preserve append order. |
| `decisionsJson` | `decisions` | JSON? | Parse; preserve append order. |

### 4.9 `contentReview` → `qs_content_reviews`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `runId` | `runId` | string | Preserve. |
| `reviewId` | `reviewId` | string | Preserve. |
| `kind` | `kind` | enum? | Preserve manual/waes. |
| `contentDigest` | `contentDigest` | string? | Preserve; validate. |
| `text` | `text` | text? | Preserve; classify content. |
| `verdict` | `verdict` | enum? | Preserve pass/revise/block. |
| `components` | `components` | string[] | Preserve order. |
| `reviewer` | `reviewer` | string? | Preserve. |
| `reviewerKind` | `reviewerKind` | enum? | Preserve human/service. |
| `reviewedAt` | `reviewedAt` | datetime? | Preserve. |
| `note` | `note` | string? | Preserve. |
| `experimentId` | `experimentId` | string? | Preserve. |
| `channel` | `channel` | string? | Preserve. |

### 4.10 `agentPublicationAudit` → `qs_agent_publication_audits`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `event` | `event` | enum | Preserve known events; unknown blocks. |
| `agentId` | `agentId` | string | Preserve. |
| `version` | `version` | integer | Preserve as the publication event's target version. |
| `actorId` | `actorId` | string | Preserve. |
| `at` | `at` | datetime | Preserve. |
| `definitionDigest` | `definitionDigest` | string | Preserve; validate. |
| `detail` | `detail` | string? | Preserve. |

### 4.11 `authorizationDecisionAudit` → `qs_authorization_decision_audits`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `route` | `route` | string | Preserve. |
| `permissions` | `permissions` | string[] | Preserve order. |
| `actorId` | `actorId` | string? | Preserve. |
| `outcome` | `outcome` | enum | Preserve allow/deny. |
| `httpStatus` | `httpStatus` | integer | Preserve. |
| `at` | `at` | datetime | Preserve. |
| `decisionCode` | `decisionCode` | string | Preserve. |

### 4.12 `telemetryTraceSpan` → `qs_telemetry_trace_spans`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `traceId`, `spanId`, `parentSpanId` | same | string | Preserve. |
| `source`, `kind`, `name`, `status` | same | enum/string | Preserve. |
| `startedAt`, `completedAt`, `durationMs` | same | datetime/integer | Preserve. |
| `requestedBy`, `runId`, `workflowId`, `decisionId`, `agentId`, `modelId`, `toolName` | same | string? | Preserve; no cross-tenant lookup. |
| `toolSucceeded` | `toolSucceeded` | boolean? | Preserve. |
| `inputTokens`, `outputTokens`, `totalTokens` | same | number? | Preserve. |
| `estimatedCostUsd` | `estimatedCostUsd` | decimal? | Preserve estimate; not an invoice. |
| `safetyDecision` | `safetyDecision` | enum? | Preserve. |

### 4.13 `review` → `qs_reviews`

| Source field | Native field | Type | Rule |
|---|---|---|---|
| `title` | `title` | string | Preserve. |
| `cadence` | `cadence` | enum | Preserve daily/weekly/stale-loops/approvals. |
| `periodStart`, `periodEnd` | same | datetime? | Preserve. |
| `summary` | `summary` | text | Preserve. |
| `highlights` | `highlights` | string[] | Preserve order. |
| `metrics` | `metrics` | JSON | Preserve all five counts. |
| `decisions` | `decisionIds` | ref[] | Ordered; same tenant. |
| `commitments` | `commitmentIds` | ref[] | Ordered; same tenant. |
| `generatedAt` | `generatedAt` | datetime | Preserve. |
| `generatedBy` | `generatedBy` | string? | Preserve. |

## 5. Coverage and acceptance

### 5.1 Field coverage

The field registry must report, per type:

- source field count and mapped count;
- fields preserved in `sourceExtensions`;
- fields explicitly excluded, with owner and reason;
- fields with a type/enum/date/money transform;
- unresolved references and unmapped fields;
- a digest over the mapping registry.

The mapping is incomplete if any retained source field is unclassified. A field may be excluded only for a documented native regeneration or an owner-approved retirement; “not used by the current UI” is not an exclusion reason.

### 5.2 Round-trip and digest fixtures

Before C1 implementation, fixtures must cover:

- absent, null, empty string, and empty array;
- a reference, a reference array, a weak reference, and a missing target;
- a draft and its published counterpart with the same business identity;
- a date, datetime, UTC offset, money with two decimals, and an invalid money value;
- an enum alias, an unknown enum, and a legacy `companyId`;
- unknown nested fields that must survive in `sourceExtensions`;
- a record whose field mapping differs between Studio and ontology shapes;
- canonical digest equality across source and native projections;
- two tenants with colliding business keys and a shared asset.

### 5.3 Ownership acceptance gate

C1 implementation may not begin from this draft until the owner approves a redacted ownership report with:

- **0** ambiguous and **0** unresolved retained content records;
- every `candidate` either confirmed or explicitly excluded;
- every legacy alias approved;
- every tenant's root organization confirmed;
- shared assets listed with a policy;
- all principal-tenant bindings validated;
- no private identifiers in the committed report.

No environment variable, default tenant, slug, display name, or inferred reference is an ownership source.

### 5.4 Explicit non-goals

This document does not implement tables, repositories, migrations, or route changes. It does not decide the `playbook` retirement, the final tenant names, the retention periods, or the per-tenant purge schedule. Those remain owner decisions. A runtime implementation must not treat this draft as authorization to import data.
