import type { TenantId, TenantScopedRecord } from '../utils/types.ts'

export class DecisionLifecycle {
  // TODO: create a proposal bound to tenant policy, evidence, workflow and actor identity.
  propose(_tenantId: TenantId, _proposal: unknown): Promise<TenantScopedRecord> {
    throw new Error('TODO: decision proposal is not implemented.')
  }

  // TODO: require external kernel authorization and a separate authenticated human approver.
  approve(_tenantId: TenantId, _decisionId: string, _approval: unknown): Promise<TenantScopedRecord> {
    throw new Error('TODO: decision approval is not implemented.')
  }

  // TODO: propose and audit rollback; never perform rollback without the required human authority.
  rollback(_tenantId: TenantId, _decisionId: string, _request: unknown): Promise<TenantScopedRecord> {
    throw new Error('TODO: decision rollback is not implemented.')
  }
}
