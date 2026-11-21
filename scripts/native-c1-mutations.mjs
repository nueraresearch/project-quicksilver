/**
 * Guards the C1 positive controls depend on, each paired with the case that must
 * fail when the guard is gone (implementation sequence Stage 8 stop point).
 *
 * A mutation is a literal edit, not a patch: `from` must occur exactly once in
 * the file, so drift in the source turns into a loud failure in
 * `native-c1-run.test.mjs` instead of a silent no-op provocation.
 */
export const MUTATIONS = [
  {
    id: 'tenant-gate',
    guard: 'a missing or blank tenant refuses before any read',
    file: 'quicksilver/cms/tenancy.ts',
    from: '  if (typeof tenantId !== \'string\' || tenantId.trim().length === 0) {',
    to: '  if (false) {',
    gate: 'quicksilver/test/c1/bootstrap.test.ts',
    expectCase: 'C1-A03',
  },
  {
    id: 'published-visibility',
    guard: 'queries see only published, non-tombstoned rows',
    file: 'quicksilver/cms/queries.ts',
    from: "const visible = (row: StoredRow): boolean => row.lifecycle === 'published' && typeof row.deleted_at !== 'string'",
    to: 'const visible = (_row: StoredRow): boolean => true',
    gate: 'quicksilver/test/c1/queries.test.ts',
    expectCase: 'C1-G01',
  },
  {
    id: 'capability-cycle',
    guard: 'an inheritance/requirement cycle refuses instead of returning a graph',
    file: 'quicksilver/cms/queries.ts',
    from: "    if (current === 'visiting') throw new UnresolvedRelationError(`capability ${id} participates in a cycle`)",
    to: "    if (current === 'visiting') return",
    gate: 'quicksilver/test/c1/queries.test.ts',
    expectCase: 'C1-G01',
  },
  {
    id: 'revision-cas',
    guard: 'a stale expectedRevision is a conflict, not an overwrite',
    file: 'quicksilver/cms/repositories.ts',
    from: '    if (Number(row.revision) !== options.expectedRevision) throw new RevisionConflictError()',
    to: '    if (false) throw new RevisionConflictError()',
    gate: 'quicksilver/test/c1/revisions.test.ts',
    expectCase: 'C1-C01',
  },
  {
    id: 'idempotency-digest',
    guard: 'the same key with a different request is a conflict',
    file: 'quicksilver/cms/idempotency.ts',
    from: '    if (existing.request_digest !== requestDigest) throw new IdempotencyConflictError()',
    to: '    if (false) throw new IdempotencyConflictError()',
    gate: 'quicksilver/test/c1/idempotency.test.ts',
    expectCase: 'C1-D02',
  },
  {
    id: 'audit-fault',
    guard: 'a failed audit/revision append aborts the primary write',
    file: 'quicksilver/cms/store.ts',
    from: '    return this.auditFaults.delete(`${operation}:${table}`)',
    to: '    this.auditFaults.delete(`${operation}:${table}`)\n    return false',
    gate: 'quicksilver/test/c1/audit-atomicity.test.ts',
    expectCase: 'C1-E01',
  },
]
