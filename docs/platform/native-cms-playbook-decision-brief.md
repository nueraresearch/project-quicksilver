# Playbook retain/retire decision brief (draft)

- **Owner:** Product Owner (Nuera RDL)
- **Status:** **Decided 2026-11-19 — retained as native, scope-fenced.** The C0 count, C1 scope, and A01 are updated to match. The option tables below are kept as the decision record.
- **Date:** 2026-11-17
- **Why now:** `playbook` was the only C0 type marked **Retirement — owner approval required**, and C0 could not exit until the Product Owner approved retirement or changed the disposition to **Native**. That decision is now recorded in §6.
- **Current C0 row:** [C0 cutover inventory](native-cms-c0-inventory.md).

## 1. Decision requested

Choose one:

- **Retain** `playbook` as a native CMS collection, or
- **Retire** the Sanity `playbook` type and keep playbooks as kernel/deploy data.

Either choice preserves the existing kernel playbook behavior. The decision is whether the CMS type is still part of the product commitment.

## 2. Facts that constrain the choice

1. **The kernel playbook capability exists and is tested.** `packages/kernel/src/playbooks/playbook.ts` validates playbooks as data, pins the content digest, requires human-and-not-author publishing, and refuses a run whose content changed. Parity tests P-067, P-068, P-069, P-074, and P-082 cover this behavior.
2. **The runtime reads files, not the Sanity type.** The active definitions are `deploy/playbooks/{genesis,onboard,operate}.json`, read by the host CLI. No application reader or writer for a Sanity `_type: "playbook"` was found in the inspected web, host, or Studio code.
3. **The CMS type is registered but not connected.** `apps/studio/schemas/playbook.ts` is registered in the Studio schema index. It has no seed fixture, route, query family, or Studio action.
4. **The seed baseline is zero, but production is unknown.** Zero means “no seed document,” not “no production document.” Only the C0 read-only export can establish the production count.
5. **The current product documents still commit to playbooks as content.** The product definition lists “Playbooks as content, swappable without touching the core” and M4 “Playbook type, Onboard playbook”; the roadmap schedules M4 with a build around December 15 and a pilot in January–February 2027. If that commitment has changed, the brief should be decided against the updated product plan, not against this snapshot.

## 3. Option A — Retain as a native collection

**Decision meaning:** `playbook` becomes a C1 native collection and repository. Its schema fields are `playbookId`, `version`, `name`, `modes`, `definitionJson`, `status`, `digest`, `authoredBy`, `publishedBy`, and `publishedAt`, plus the required native tenant, revision, lifecycle, and audit fields.

**C0/C1 consequence:**

| Area | Consequence |
|---|---|
| C0 counts | **21 native, 13 derived, 2 optional adapter, 0 retirement**; the blocker closes as retained. |
| C1 scope | **34 stores** instead of 33. Add a `playbook` field-mapping table, tenant ownership entry, repository, and store-registration case. C1 acceptance case A01 changes from 20+13 to 21+13. |
| Data migration | Import existing production `playbook` documents if the export finds any. If the export finds none, create the collection with zero rows; do not invent seed data. |
| Validation | Import only documents that validate against the current kernel `PlaybookDefinition`. A document that fails validation is preserved as a reviewed exception, never coerced into a valid-looking record. |
| Runtime | No change in C1. `deploy/playbooks/*.json` remains the runtime source until an M4 integration makes the native collection authoritative. |
| Routes | None added by C1. No new web API or kernel read path. |
| Admin | Do not expose an editable Playbook screen until native is the runtime source; otherwise editors can write records the kernel never reads. |
| Product alignment | Consistent with the current “Playbooks as content” and M4 language. |

**Cost and risk:** one extra collection, repository, field mapping, and test registration; a dormant native store until M4; a possible dual-source period. The dual-source risk is bounded by freezing native writes and naming the deploy files as authoritative until the integration decision.

## 4. Option B — Retire the Sanity playbook type

**Decision meaning:** C0 records an owner-approved retirement. The Studio schema is removed only in the approved cutover step after C0; C0 itself remains read-only. No native collection, repository, field map, route, or admin screen is created.

**C0/C1 consequence:**

| Area | Consequence |
|---|---|
| C0 counts | **20 native, 13 derived, 2 optional adapter, 1 approved retirement**; the blocker closes as retired. |
| C1 scope | Stays at **33 stores**. No `playbook` table, repository, tenant ownership row, or acceptance-case change. |
| Data migration | The C0 export must still count `_type == "playbook"` documents. If any exist, export them to an owner-approved archive with a digest and exclude them from native import; do not hard-delete them before the retention decision. If none exist, record a zero count. |
| Validation | No native validation or import path exists. Archived definitions are evidence, not runtime content. |
| Runtime | No change. The kernel continues to read `deploy/playbooks/*.json`; the existing tests remain the regression proof. |
| Routes | No change; there is no playbook route today. |
| Admin | No native Playbook screen. |
| Product alignment | Requires updating the “Playbooks as content” and M4 “Playbook type” wording, or explicitly treating the kernel/deploy format as the M4 type and deferring the CMS admin to a later milestone. |

**Cost and risk:** lower migration scope now, but a future M4 or enterprise request to edit playbooks through the CMS would reopen C0/C1 and require a new schema, repository, migration, and tenant decision. If production documents exist, they become archive-only rather than native content.

## 5. Recommendation

**Retain, scope-fenced, if M4 remains committed.** Retain `playbook` as a C1 schema and repository, keep `deploy/playbooks/*.json` as the runtime authority until the M4 integration, and do not expose native writes before the kernel reads them. This preserves the product commitment and avoids reopening the cutover later, while adding only one store and no production route.

**Retire if M4’s CMS authoring path is no longer committed.** In that case, retire the Sanity type, keep the kernel/deploy playbooks, and update the product/roadmap language in the same decision. Do not retain a dormant editable collection without an owner and a delivery date.

**Recorded decision (2026-11-19): Option A — retained, scope-fenced.** M4’s CMS authoring path is still committed, so the collection is created in C1 while `deploy/playbooks/*.json` remains the runtime authority.

The production export is required under either option. Neither choice can claim a zero production count from the seed baseline.

## 6. Sign-off

- [x] **Retain as native**, with deploy JSON authoritative until M4 integration.
- [ ] **Retire the Sanity type**, keep kernel/deploy playbooks, and update the product/roadmap language.
- [ ] **Defer** (C0 remains blocked; no disposition change).

Product Owner: Nuera RDL  Date: 2026-11-19

Decision note / conditions: Retained, scope-fenced. C0 count is **21 native, 13 derived, 2 optional adapter, 0 retirement**; C1 scope is **34 stores** and `C1-A01` expects 21 + 13. Conditions: no native admin screen and no native write path before M4 integration; `deploy/playbooks/*.json` remains authoritative and the kernel playbook tests remain the regression proof; `playbook` stays in the export `scopeTypes` and imports only documents that validate against the current kernel `PlaybookDefinition`; no seed data is invented if the export finds no documents.
