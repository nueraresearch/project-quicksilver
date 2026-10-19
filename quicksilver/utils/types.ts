export type TenantId = string

export interface TenantScopedRecord {
  id: string
  tenantId: TenantId
}

export interface TenantRelation<T extends TenantScopedRecord = TenantScopedRecord> {
  relation: T
  tenantId: TenantId
}
