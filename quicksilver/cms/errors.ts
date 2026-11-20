/**
 * The C1 repository error vocabulary (schema and repository map §2.5).
 *
 * These eight codes are the contract: HTTP status mapping belongs to C2. A
 * repository refuses with one of them rather than returning a partial result, so
 * a caller cannot mistake a refusal for an empty page.
 */
export type RepositoryErrorCode =
  | 'NotFound'
  | 'CrossTenantRelation'
  | 'RevisionConflict'
  | 'IdempotencyConflict'
  | 'UnresolvedRelation'
  | 'MalformedQuery'
  | 'AppendOnlyViolation'
  | 'AuditWriteFailed'

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode

  constructor(code: RepositoryErrorCode, message: string) {
    super(message)
    this.name = code
    this.code = code
  }
}

/** A record that does not exist in the caller's tenant, including a foreign id. */
export class NotFoundError extends RepositoryError {
  constructor(message = 'record not found') {
    super('NotFound', message)
  }
}

/** A relation target that exists in another tenant. Never rewritten to a local row. */
export class CrossTenantRelationError extends RepositoryError {
  constructor(message = 'relation target belongs to another tenant') {
    super('CrossTenantRelation', message)
  }
}

/** A write stated a revision that is no longer current. */
export class RevisionConflictError extends RepositoryError {
  constructor(message = 'expected revision is not current') {
    super('RevisionConflict', message)
  }
}

/** A key was reused with a different normalized request. */
export class IdempotencyConflictError extends RepositoryError {
  constructor(message = 'idempotency key was used for a different request') {
    super('IdempotencyConflict', message)
  }
}

/** A required relation points at a target that does not exist in the tenant. */
export class UnresolvedRelationError extends RepositoryError {
  constructor(message = 'relation target does not resolve in this tenant') {
    super('UnresolvedRelation', message)
  }
}

/** Missing, blank or invalid input, including a missing tenant. */
export class MalformedQueryError extends RepositoryError {
  constructor(message = 'malformed query') {
    super('MalformedQuery', message)
  }
}

/** An update or hard delete against an append-only row. */
export class AppendOnlyViolationError extends RepositoryError {
  constructor(message = 'append-only record cannot be updated or deleted') {
    super('AppendOnlyViolation', message)
  }
}

/** A required audit or evidence append failed, so the mutation was aborted. */
export class AuditWriteFailedError extends RepositoryError {
  constructor(message = 'required audit append failed; the mutation was aborted') {
    super('AuditWriteFailed', message)
  }
}

/**
 * A C1 surface that exists but is not implemented in this stage. Deliberately
 * not one of the eight contract codes: a caller must not be able to treat an
 * unimplemented query as a repository refusal or an empty result.
 */
export class StageNotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StageNotImplementedError'
  }
}
