/**
 * The tenant gate every repository, relation and query goes through.
 *
 * Its own module so relations and queries can use it without importing the
 * repository module back (which would be an import cycle).
 */
import { MalformedQueryError } from './errors.ts'

export type TenantId = string

export function requireTenant(tenantId: unknown): TenantId {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new MalformedQueryError('tenantId is required and must not be blank')
  }
  return tenantId
}
