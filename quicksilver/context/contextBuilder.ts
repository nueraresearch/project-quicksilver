import type { TenantId } from '../utils/types.ts'

export interface TenantContext {
  tenantId: TenantId
  records: unknown[]
  generatedAt: string
}

// TODO: construct deterministic, bounded, provenance-preserving context from tenant-scoped queries.
export function buildContextForTenant(_tenantId: string): Promise<TenantContext> {
  throw new Error('TODO: buildContextForTenant is not implemented.')
}
