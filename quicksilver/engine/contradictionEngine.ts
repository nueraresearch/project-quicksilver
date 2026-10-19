import type { TenantId, TenantScopedRecord } from '../utils/types.ts'

export class ContradictionEngine {
  // TODO: detect conflicting applicable policies using explicit priority and scope rules.
  detectPolicyConflicts(_tenantId: TenantId): Promise<TenantScopedRecord[]> {
    throw new Error('TODO: policy conflict detection is not implemented.')
  }

  // TODO: check evidence consistency and preserve source/provenance for every finding.
  checkEvidenceConsistency(_tenantId: TenantId): Promise<TenantScopedRecord[]> {
    throw new Error('TODO: evidence consistency checks are not implemented.')
  }

  // TODO: detect metric drift from versioned observations without inventing missing values.
  detectMetricDrift(_tenantId: TenantId): Promise<TenantScopedRecord[]> {
    throw new Error('TODO: metric drift detection is not implemented.')
  }
}
