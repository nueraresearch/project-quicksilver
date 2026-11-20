# ADR 0004: Native CMS deletion and tombstone model

- **Status:** Proposed
- **Date:** 2026-11-17
- **Deciders:** Product Owner (Nuera RDL)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** [ADR 0001](adr-0001-native-first-ownership.md) · [ADR 0003](adr-0003-native-local-operation.md) · [Native CMS cutover](native-cms-cutover.md) · [C0 inventory](native-cms-c0-inventory.md) · [Threat model](threat-model.md) · [Parity tests](parity-tests.md)

This is a proposed record. It fixes the model that the cutover gates must implement;
it does not implement it. The body digest is added when the record is accepted.

## Context

The cutover plan already requires baseline-and-export reconciliation, soft-delete
404 behavior, purge 410 behavior, an append-only `restored` state, and an audit
record for every deletion. This record makes those requirements one native CMS
model so they are not re-invented per content type, per route, or per adapter.

The immediate problem is that **absence is ambiguous**. A Sanity export does not
contain a row for a deleted document. Taken alone, a missing row could mean any of
the following:

- the document was deliberately deleted;
- it was created after the baseline and deleted before the export;
- it was never in scope for this export;
- the export was filtered, paginated, truncated, or authorized differently;
- the document still exists but the export has a bug;
- the document is a draft or release version that the export does not cover.

Treating any of those as a deletion either loses content silently or fabricates
deletion history. The reverse error is just as bad: treating every missing row as
"not exported" hides a real deletion and lets a removed record reappear as active
on a later restore.

The native CMS therefore needs a deletion record that is independent of whether
the payload still exists. That record is the tombstone.

This decision applies to every retained content type in the native CMS and to
assets reconciled by the cutover. It does not change the rule that decisions,
approvals, authorization records, execution audits, and the intent ledger are
append-only and are not content that a CMS delete may remove.

## Decision

### D1 — The tombstone ledger is first-class and append-only

Every deletion and restore appends an immutable tombstone event. The current
tombstone is the latest event for a `(tenantId, documentId)` pair; earlier events
remain readable and are never overwritten.

A tombstone event carries at least:

| Field | Meaning |
|---|---|
| `tombstoneId` | Stable identifier for this event |
| `tenantId` | Tenant that owns the record |
| `documentId` | Original document ID, including the draft/published distinction |
| `documentType` | Retained schema type |
| `state` | `deleted` or `restored` |
| `deletedAt`, `deletedBy` | When and by whom the deletion was applied |
| `deletionReason` | Operator reason or declared retention reason |
| `deletionSource` | `operator`, `retention-policy`, or `import-reconciliation` |
| `preDeleteRev` | Revision of the last active record |
| `preDeleteDigest` | Digest of the last active payload and its references |
| `restoredAt`, `restoredBy` | When and by whom the restore was applied |
| `purgedAt` | Terminal purge marker; absent until payload purge |
| `approvalId` | Approval or authorization record supporting the transition |
| `previousEventDigest` | Digest of the preceding tombstone event, or empty for the first |
| `tombstoneDigest` | Digest of this event's canonical fields |

`tombstoneDigest` detects accidental or unreviewed mutation. It is not a
signature and does not claim to stop an operator who can rewrite the database;
that is what append-only storage, database permissions, and the audit record are
for.

A successful delete or restore must not depend on a later cleanup job to create
its audit trail. The content mutation and its audit event commit together or
neither commits.

### D2 — Deletion is evidence, never an inference from absence

A record is treated as deleted only when all of the following are true:

1. it is present in the frozen baseline or has separate creation evidence;
2. it is absent from the frozen-scope current export, or has an explicit deletion
   record;
3. matching deletion evidence exists;
4. the evidence's tenant, document ID, type, and pre-delete digest match; and
5. the native tombstone ledger agrees with that evidence.

The evidence source is one of:

- `sanity-history` — a document history entry that identifies the delete;
- `operator-confirmed` — a named content owner signs a confirmation with the revision or digest they relied on; or
- `retention-policy` — a dated policy decision that identifies the records and
  the rule applied.

`export-diff` is not a deletion source. It can identify a missing record; it
cannot explain why the record is missing.

A pre-baseline deletion is outside the comparison. It may be recorded as
reference material, but it is not counted as a deletion in the migration, does
not create a native tombstone, and does not make the reconciliation fail.

**Deletion Evidence Record.** A record is only evidence if it carries
`evidenceId`, `tenantId`, `documentId`, `documentType`, `deletedAt`, `deletedBy`,
`deletionReason`, `source`, `preDeleteRev`, `preDeleteDigest`, `evidenceRef`,
`recordedAt`, `recordedBy`, and a signature or approval reference. A batch record
is acceptable only when it enumerates every affected ID and digest; a count is
not evidence.

### D3 — Soft delete is the default; hard purge is separate

The initial cutover uses soft delete only. Deletion hides the record from normal
reads but retains its payload, references, assets, and tombstone until a separate
retention decision permits purge.

Hard purge is not required to demote Sanity and is not enabled by this record. It
is an owner-approved retention operation with its own approval, legal-hold check,
and audit evidence. D6 governs it.

### D4 — Restore is an appended transition, not a resurrection

Restore preserves the original `documentId` and appends a `restored` tombstone
event. It does not create a new ID, does not revive the pre-deletion revision by
overwriting the tombstone, and does not erase the deletion event.

The resulting active record has a new revision and digest. Its history is
`active → deleted → restored → active`; the tombstone ledger still shows both the
deletion and the restore.

Creating a new record with an ID that has a current `deleted` tombstone is
refused. The caller must use the explicit restore path. Creating that ID after a
purge is also refused; a purged ID is terminal.

### D5 — Reads distinguish missing, deleted, and purged

Normal content reads:

- return **404** when the record is missing or has a current soft-delete;
- return **410** when the record has a `purgedAt` marker; and
- never return a tombstoned or purged record as active.

The 404 for a soft-delete is deliberate: a normal reader must not learn that a
tenant once had a record merely from its deletion. Audit-scoped reads may expose
the tombstone, revision, actor, reason, and timestamps, but only through an
explicitly authorized audit path and only for the caller's tenant.

A purged record remains 410; it does not become 404 merely because its payload is
gone.

### D6 — Purge removes payload, not authority

A permitted purge removes the content payload and eligible binary assets. It
retains:

- the tombstone event and its digest chain;
- `preDeleteDigest` and `tombstoneDigest`;
- the deletion, restore, and purge audit events;
- the approval or policy record that authorized the purge; and
- enough metadata to answer 410 and to prove that the ID is terminal.

Purge is blocked by a legal hold, by unresolved references that the retention
policy requires, and by any missing or mismatched audit record. Purge is
idempotent; a second request returns the existing terminal state and appends no
second purge event.

Restoring a purged record is refused. Recreating its ID is refused. A backup or
point-in-time restore that predates the purge must replay the tombstone and purge
events before serving reads; it may not make the purged record active again.

### D7 — Deletion and restore are human content-administrator actions

A human content administrator may delete or restore a record, subject to tenant
authorization and the reference policy. An agent may propose a deletion but may
not apply one. The service account that applies an approved retention policy may
purge only under that policy, not under an agent's ad hoc instruction.

Every delete, restore, and purge has an audit event. The existing authorization
audit records denied attempts; a denied attempt does not create a content
tombstone event.

### D8 — Tombstones and audit records outlive content payloads

Soft-deleted payloads are retained for at least 30 days after deletion before
they become eligible for purge. A tenant policy may extend that period. The
30-day minimum is a floor, not an automatic purge schedule.

Tombstones, deletion evidence, and audit events are not removed by a content
payload purge. They are retained for the life of the tenant. Tenant closure does
not by itself authorize deleting them; a separate owner-approved records-retention
decision must name any post-closure period.

Decisions, approvals, authorization records, execution audits, and the intent
ledger are never hard-deleted by the CMS. A retention action may remove payload
or attachment bytes, but it may not remove the authority record that explains
why the action happened.

## Deleted versus missing export records

The reconciliation uses a frozen baseline, a current export with an identical
scope, and deletion evidence. It classifies each record before importing
anything.

| Classification | Baseline | Current export | Evidence | Required result |
|---|---|---|---|---|
| `active` | present | present | none needed | Digest matches; no tombstone |
| `deleted` | present | missing | Matching deletion evidence and pre-delete digest | Import a `deleted` tombstone |
| `created_then_deleted` | absent | absent | Creation evidence plus matching deletion evidence | Import a `deleted` tombstone; do not invent an active record |
| `unexplained_missing` | present | missing | None, or evidence does not match ID/type/tenant/digest | **Block reconciliation** |
| `unexpected_deletion` | present or absent | present or missing | Deletion evidence conflicts with an active or restored record | **Block reconciliation** |
| `resurrected` | present | present | Current tombstone says `deleted` and there is no `restored` event | **Block reconciliation** |
| `tombstone_mismatch` | any | any | Tombstone digest, pre-delete digest, tenant, or type disagrees | **Block reconciliation** |
| `scope_excluded` | present | excluded by a changed filter, page, or permission scope | None | **Block comparison** until scope is restored |
| `pre_baseline_deletion` | absent | absent | Deletion evidence dated before the baseline | Reference only; not a migration deletion |

A record that is present in both baseline and current export but has a changed
digest is a content change, not a deletion. It must be reconciled as a change and
must not be assigned a tombstone.

A `created_then_deleted` record is not evidence that the current export is
complete. It requires its own creation record, and its `preDeleteDigest` must
equal the creation digest; otherwise it is `unexplained_missing`.

Asset reconciliation uses the same evidence and digest rules. A missing binary
alone is not an asset deletion; the asset record and its deletion evidence must
agree, and the asset ledger records `active`, `tombstoned`, `purged`, or
`archived` separately from the content tombstone.

## Restored-state transitions

| From | Action | To | Conditions | Evidence appended |
|---|---|---|---|---|
| active | delete | deleted | Authorized human; references satisfy policy; no current deletion event | `content.delete.requested`, then `content.delete.applied`; tombstone state `deleted` |
| deleted | restore | restored / active | Authorized human; original ID retained; payload recoverable; not purged | `content.restore.requested`, then `content.restored`; tombstone state `restored` |
| deleted | delete again | deleted | Idempotent; no new transition | No new tombstone; return the existing state |
| restored / active | delete | deleted | A new deletion after a restore | New `deleted` event; earlier `restored` event remains |
| deleted | purge | deleted + `purgedAt` | Owner-approved policy; retention window elapsed; no legal hold; audit complete | `content.purge.requested`, then `content.purged` |
| restored / active | purge | — | Refused; delete first | No transition |
| purged | restore or recreate | — | Refused; terminal ID | No transition |

An active record whose latest tombstone event is `deleted` is an inconsistent
state. It fails closed: normal reads do not serve it, deletion/restore tools
report the inconsistency, and reconciliation blocks until the ledger is
explained. A record whose latest event is `restored` may be active; an explicit
new delete appends a new event rather than changing the old one.

Repeated delete is idempotent and returns the existing tombstone. Repeated
restore of an already restored record is idempotent and returns the active
record. Neither appends a duplicate event.

## Audit events

The content audit stream uses these stable event names:

| Event | When | Required content |
|---|---|---|
| `content.delete.requested` | After authorization, before mutation | Actor, tenant, document ID/type, reason, source, correlation ID |
| `content.delete.applied` | When the tombstone commits | Tombstone ID, pre-delete revision/digest, tombstone digest, approval ID |
| `content.restore.requested` | After authorization, before mutation | Actor, tenant, document ID/type, reason, correlation ID |
| `content.restored` | When the restored state commits | Tombstone ID, new revision/digest, prior deletion event ID, approval ID |
| `content.purge.requested` | After policy and legal-hold checks, before purge | Actor or retention service, tenant, document ID/type, policy ID, correlation ID |
| `content.purged` | When payload removal commits | Tombstone ID, purged digest, retained audit IDs, policy/approval ID |

Every event also carries `eventId`, `tenantId`, `occurredAt`, `actor`, `actorKind`,
`documentId`, `documentType`, `beforeDigest`, `afterDigest`, `correlationId`, and
the applicable `approvalId` or `policyId`. The event is append-only; an update or
delete of an audit event is itself a security incident.

The native CMS must refuse the content mutation if its audit event cannot be
written. A best-effort audit write is not sufficient. A retention job that purges
many records must record one event per record or one bounded batch event that
enumerates every affected tombstone; it may not record only a count.

Agents and other non-human callers receive a refusal, and the existing
authorization audit records the denial. They do not get a content tombstone
event, because no content transition occurred.

## Retention and purge rules

1. **Soft delete is the cutover default.** No purge is enabled during C0–C7
   unless a separate owner approval explicitly enables it.
2. **Minimum payload retention.** A soft-deleted payload is not purge-eligible
   until 30 days after `deletedAt`. Tenant policy may require longer.
3. **Legal hold wins.** A legal hold blocks purge even after the retention
   window. It does not silently block a soft delete; a held record may still be
   hidden from normal reads.
4. **Authority records never purge.** Decisions, approvals, authorization
   records, execution audits, tombstone events, and the intent ledger are outside
   content purge. Only payload and eligible binary objects may be removed.
5. **Purge is terminal.** A purged record reads as 410, cannot be restored, and
   cannot be recreated under the same ID. Its tombstone, digests, and audit
   events remain.
6. **No resurrection through restore.** A backup or point-in-time restore replays
   all later tombstones, restores, and purge markers before serving reads. If the
   ledger cannot be replayed, the restore fails closed rather than serving a
   deleted record as active.
7. **Assets follow references.** An asset may be tombstoned with its content, but
   its binary is purged only when no active record references it and the asset
   retention policy permits it. Asset metadata and digests remain after purge.
8. **Bulk retention is controlled.** A retention job is idempotent, bounded,
   dry-run by default, and audited. It refuses on a missing ledger, a digest
   mismatch, a legal hold, or an unresolved reference. It may not delete an
   authority record to satisfy a retention target.

Tenant-specific retention periods beyond the 30-day minimum, the legal-hold
workflow, and the owner of the purge schedule remain owner decisions. This record
sets the floor and the invariants; it does not enable a purge program.

## Consequences

**Positive**

- A missing export row no longer becomes an accidental deletion, and a real
  deletion no longer disappears because the payload is absent from the export.
- Restore preserves stable references and leaves a readable history instead of
  overwriting the evidence that a record was deleted.
- Audit, tenant isolation, and 404/410 behavior survive reverse migration and
  backup restore.
- The model applies to every content type and asset rather than to whichever
  route was implemented last.

**Negative**

- Tombstones, digests, and audit events consume storage after the payload is
  gone.
- Deletion reconciliation needs usable Sanity history or a named operator
  confirmation. If neither exists, the migration blocks instead of guessing.
- Restore is more than flipping a flag: it creates a new active revision and must
  satisfy reference and audit checks.
- Purge is deliberately hard to run and cannot be used to clean up an
  inconsistent ledger.

**Neutral**

- Sanity remains an optional adapter after cutover. Reverse migration maps native
  tombstones to audited Sanity deletions; it does not dual-write or assume Sanity
  has a tombstone model.
- The exact database, object store, and retention scheduler are implementation
  choices. The ledger contract is not.

## What this record does not decide

- The database schema, tombstone table names, or whether the ledger is stored in
  the content database or a separate audit store.
- The exact tenant retention period beyond the 30-day minimum, or the post-tenant
  closure schedule.
- Whether hard purge is ever enabled for a particular tenant.
- The legal-hold workflow, its owner, or how a hold is released.
- The asset binary purge cadence and the storage lifecycle rules for object
  stores.
- RPO and RTO targets. The cutover plan owns those.
- Whether audit-scoped content reads get a dedicated UI. The authorization and
  audit boundary is decided here; the interface is not.

## Alternatives considered

**Hard delete only.** Rejected: it destroys the only evidence that a record
existed, makes restore impossible, and turns an export gap into permanent loss.

**Treat every missing export row as deleted.** Rejected: filters, pagination,
permissions, and export bugs all produce the same signal. The model would create
false tombstones and lose content that was never deleted.

**Treat every missing row as not exported.** Rejected: it hides real deletions
and lets a deleted record return as active after a restore.

**Overwrite the tombstone on restore.** Rejected: it erases the deletion event,
breaks the digest chain, and makes "was this ever deleted?" unanswerable.

**Restore by creating a new ID.** Rejected: stable references, citations, and
reverse migration would break, and the old ID would remain permanently unusable.

**Keep Sanity as the deletion authority.** Rejected: Sanity is the migration
source, not the native runtime. A native deletion model cannot depend on a
provider's history API or on dual writes.

**Retain payload forever and never purge.** Rejected as a universal rule: it
ignores legal and tenant retention obligations. It remains the safe default until
a separate purge policy is approved.

## Review

Re-read this record at C4, before the first C5 reconciliation, before C6's
canary, and before any purge is enabled. The question that matters while reading
it: **can every disappearance be explained by evidence, and can every restoration
be explained by an appended event?**

The minimum tests implied by this record are:

- a missing record with no deletion evidence blocks reconciliation;
- a matching deletion evidence record imports exactly one tombstone;
- a created-then-deleted record does not become active;
- a deleted record is 404 normally and visible only through audit scope;
- restore preserves the original ID and leaves the deletion event readable;
- repeated delete and restore are idempotent;
- a purged record is 410 and cannot be restored or recreated;
- an audit-write failure aborts the content mutation;
- a cross-tenant delete, restore, or audit read is refused;
- an agent delete is refused and recorded as a denial;
- a backup restore replays tombstones and does not resurrect deleted content; and
- a legal hold blocks purge while leaving the tombstone intact.
