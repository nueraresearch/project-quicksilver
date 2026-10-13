/**
 * Governed principal and role administration engine.
 *
 * Enforces:
 * - Deny by default.
 * - Humans only for authority permissions.
 * - Separation of duties: caller cannot grant roles to themselves.
 * - Tenant isolation: cannot administer across tenants.
 * - Fail-closed audit logging: if audit fails, mutation aborts.
 */
import {
  AccessController,
  AUTHORITY_PERMISSIONS,
  BUILT_IN_ROLES,
  validatePrincipal,
  type AccessDecision,
  type Permission,
  type Principal,
  type RoleDefinition,
} from './rbac.ts'

export interface PrincipalAdminAuditEntry {
  action: 'create-principal' | 'update-principal' | 'disable-principal' | 'enable-principal' | 'create-role'
  actorId: string
  tenantId: string
  targetId: string
  details?: Record<string, unknown>
  at: number
}

export interface PrincipalStore {
  getPrincipal(tenantId: string, id: string): Promise<Principal | undefined>
  listPrincipals(tenantId: string): Promise<Principal[]>
  savePrincipal(principal: Principal): Promise<void>
  getCustomRole?(tenantId: string, id: string): Promise<RoleDefinition | undefined>
  listCustomRoles?(tenantId: string): Promise<RoleDefinition[]>
  saveCustomRole?(role: RoleDefinition): Promise<void>
}

export class InMemoryPrincipalStore implements PrincipalStore {
  private readonly principals = new Map<string, Principal>()
  private readonly roles = new Map<string, RoleDefinition>()

  private key(tenantId: string, id: string): string {
    return `${tenantId}::${id}`
  }

  async getPrincipal(tenantId: string, id: string): Promise<Principal | undefined> {
    const p = this.principals.get(this.key(tenantId, id))
    return p ? { ...p, roles: [...p.roles] } : undefined
  }

  async listPrincipals(tenantId: string): Promise<Principal[]> {
    return Array.from(this.principals.values())
      .filter((p) => p.tenantId === tenantId)
      .map((p) => ({ ...p, roles: [...p.roles] }))
  }

  async savePrincipal(principal: Principal): Promise<void> {
    this.principals.set(this.key(principal.tenantId, principal.id), {
      ...principal,
      roles: [...principal.roles],
    })
  }

  async getCustomRole(tenantId: string, id: string): Promise<RoleDefinition | undefined> {
    const r = this.roles.get(this.key(tenantId, id))
    return r ? { ...r, permissions: [...r.permissions] } : undefined
  }

  async listCustomRoles(tenantId: string): Promise<RoleDefinition[]> {
    return Array.from(this.roles.values())
      .filter((r) => r.tenantId === tenantId)
      .map((r) => ({ ...r, permissions: [...r.permissions] }))
  }

  async saveCustomRole(role: RoleDefinition): Promise<void> {
    if (!role.tenantId) throw new Error('Custom role must have a tenantId.')
    this.roles.set(this.key(role.tenantId, role.id), {
      ...role,
      permissions: [...role.permissions],
    })
  }
}

export interface PrincipalAdminServiceOptions {
  store: PrincipalStore
  accessController?: AccessController
  auditSink?: (entry: PrincipalAdminAuditEntry) => Promise<void> | void
  now?: () => number
}

export class PrincipalAdminService {
  private readonly store: PrincipalStore
  private readonly accessController: AccessController
  private readonly auditSink?: (entry: PrincipalAdminAuditEntry) => Promise<void> | void
  private readonly now: () => number

  constructor(options: PrincipalAdminServiceOptions) {
    this.store = options.store
    this.accessController = options.accessController ?? new AccessController()
    this.auditSink = options.auditSink
    this.now = options.now ?? Date.now
  }

  private async audit(entry: PrincipalAdminAuditEntry): Promise<void> {
    if (this.auditSink) {
      try {
        await this.auditSink(entry)
      } catch (err) {
        throw new Error(`Audit sink failure; administrative mutation aborted: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  private checkAuthority(actor: Principal, targetTenantId: string): void {
    if (actor.tenantId !== targetTenantId) {
      throw new Error(`Cross-tenant administration denied: actor is ${actor.tenantId}, target is ${targetTenantId}.`)
    }
    const decision = this.accessController.authorize(actor, 'tenant:admin', { tenantId: targetTenantId })
    if (!decision.allowed) {
      throw new Error(`Access denied: principal "${actor.id}" lacks tenant:admin permission.`)
    }
  }

  async listPrincipals(actor: Principal, tenantId: string): Promise<Principal[]> {
    this.checkAuthority(actor, tenantId)
    return this.store.listPrincipals(tenantId)
  }

  async createPrincipal(
    actor: Principal,
    principal: Principal,
  ): Promise<Principal> {
    this.checkAuthority(actor, principal.tenantId)

    // Separation of duties: caller cannot create or modify their own roles through this path
    if (actor.id === principal.id) {
      throw new Error('Separation of duties: administrators cannot create or modify their own principal record.')
    }

    const validationErrors = validatePrincipal(principal)
    if (validationErrors.length > 0) {
      throw new Error(`Invalid principal: ${validationErrors.join(', ')}`)
    }

    // Agent/service principals cannot hold authority permissions
    if (principal.kind !== 'human') {
      for (const roleId of principal.roles) {
        const builtIn = BUILT_IN_ROLES.find((r) => r.id === roleId)
        if (builtIn && builtIn.permissions.some((p) => AUTHORITY_PERMISSIONS.includes(p))) {
          throw new Error(`Non-human principal "${principal.id}" cannot be assigned role "${roleId}" with authority permissions.`)
        }
      }
    }

    const existing = await this.store.getPrincipal(principal.tenantId, principal.id)
    if (existing) {
      throw new Error(`Principal "${principal.id}" already exists in tenant "${principal.tenantId}".`)
    }

    await this.audit({
      action: 'create-principal',
      actorId: actor.id,
      tenantId: principal.tenantId,
      targetId: principal.id,
      details: { kind: principal.kind, roles: principal.roles },
      at: this.now(),
    })

    await this.store.savePrincipal(principal)
    return principal
  }

  async setPrincipalRoles(
    actor: Principal,
    tenantId: string,
    principalId: string,
    roles: string[],
  ): Promise<Principal> {
    this.checkAuthority(actor, tenantId)

    if (actor.id === principalId) {
      throw new Error('Separation of duties: administrators cannot grant or modify their own roles.')
    }

    const existing = await this.store.getPrincipal(tenantId, principalId)
    if (!existing) {
      throw new Error(`Principal "${principalId}" not found in tenant "${tenantId}".`)
    }

    const updated: Principal = {
      ...existing,
      roles: [...roles],
    }

    const validationErrors = validatePrincipal(updated)
    if (validationErrors.length > 0) {
      throw new Error(`Invalid principal configuration: ${validationErrors.join(', ')}`)
    }

    if (updated.kind !== 'human') {
      for (const roleId of updated.roles) {
        const builtIn = BUILT_IN_ROLES.find((r) => r.id === roleId)
        if (builtIn && builtIn.permissions.some((p) => AUTHORITY_PERMISSIONS.includes(p))) {
          throw new Error(`Non-human principal cannot be assigned role "${roleId}" with authority permissions.`)
        }
      }
    }

    await this.audit({
      action: 'update-principal',
      actorId: actor.id,
      tenantId,
      targetId: principalId,
      details: { previousRoles: existing.roles, newRoles: roles },
      at: this.now(),
    })

    await this.store.savePrincipal(updated)
    return updated
  }

  async setPrincipalDisabled(
    actor: Principal,
    tenantId: string,
    principalId: string,
    disabled: boolean,
  ): Promise<Principal> {
    this.checkAuthority(actor, tenantId)

    if (actor.id === principalId) {
      throw new Error('Separation of duties: administrators cannot disable or enable their own principal record.')
    }

    const existing = await this.store.getPrincipal(tenantId, principalId)
    if (!existing) {
      throw new Error(`Principal "${principalId}" not found in tenant "${tenantId}".`)
    }

    const updated: Principal = { ...existing, disabled }

    await this.audit({
      action: disabled ? 'disable-principal' : 'enable-principal',
      actorId: actor.id,
      tenantId,
      targetId: principalId,
      at: this.now(),
    })

    await this.store.savePrincipal(updated)
    return updated
  }
}
