/**
 * The tenant boundary at the request edge (C1 exit: tenant derived from the
 * authenticated principal).
 *
 * The rule the matrix enforces on repositories is that no read takes a tenant
 * from a body, a query parameter, an environment variable or a default. This
 * module is the other half: the tenant comes from the verified session, and a
 * caller that also supplies one is refused when it disagrees rather than being
 * quietly overridden.
 *
 * `MalformedQuery` is the existing contract code for "missing, blank or invalid
 * input, including a missing tenant", so an unauthenticated request and a
 * blank-tenant request are the same refusal and neither is a `NotFound` that
 * could be mistaken for an empty result.
 */
import { MalformedQueryError } from './errors.ts'
import { requireTenant, type TenantId } from './tenancy.ts'

/** The part of a verified session the content layer may rely on. */
export interface AuthenticatedPrincipal {
  /** Verified subject of the session: the actor for writes and audits. */
  readonly subject: string
  /** The tenant the session belongs to. Never read from the request body. */
  readonly tenantId: string
}

export interface PrincipalScope {
  readonly tenantId: TenantId
  readonly actorId: string
}

/**
 * Resolves the tenant and actor a content call runs as. Refuses rather than
 * falling back to any other source, so a missing login cannot borrow a tenant.
 */
export function principalScope(principal: unknown): PrincipalScope {
  if (!principal || typeof principal !== 'object' || Array.isArray(principal)) {
    throw new MalformedQueryError('an authenticated principal is required')
  }
  const { subject, tenantId } = principal as Partial<AuthenticatedPrincipal>
  if (typeof subject !== 'string' || subject.trim().length === 0) {
    throw new MalformedQueryError('the principal has no subject')
  }
  return { tenantId: requireTenant(tenantId), actorId: subject }
}

/**
 * The tenant a request may act on. A caller-supplied tenant is accepted only
 * when it equals the principal's; any other value is refused, never widened.
 */
export function tenantFromPrincipal(principal: unknown, claimedTenantId?: unknown): TenantId {
  const { tenantId } = principalScope(principal)
  if (claimedTenantId !== undefined && claimedTenantId !== null && claimedTenantId !== tenantId) {
    throw new MalformedQueryError('the tenant comes from the principal and cannot be supplied by the caller')
  }
  return tenantId
}
