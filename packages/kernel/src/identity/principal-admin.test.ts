import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  InMemoryPrincipalStore,
  PrincipalAdminService,
  type PrincipalAdminAuditEntry,
} from './principal-admin.ts'
import type { Principal } from './rbac.ts'

const admin: Principal = {
  id: 'user:admin@acme.com',
  kind: 'human',
  tenantId: 'acme',
  roles: ['tenant-admin'],
}

const viewer: Principal = {
  id: 'user:viewer@acme.com',
  kind: 'human',
  tenantId: 'acme',
  roles: ['viewer'],
}

const rivalAdmin: Principal = {
  id: 'user:admin@rival.com',
  kind: 'human',
  tenantId: 'rival',
  roles: ['tenant-admin'],
}

test('PrincipalAdminService: denies access without tenant:admin', async () => {
  const store = new InMemoryPrincipalStore()
  const svc = new PrincipalAdminService({ store })

  await assert.rejects(
    svc.listPrincipals(viewer, 'acme'),
    /lacks tenant:admin/,
  )
})

test('PrincipalAdminService: denies cross-tenant operations', async () => {
  const store = new InMemoryPrincipalStore()
  const svc = new PrincipalAdminService({ store })

  await assert.rejects(
    svc.listPrincipals(rivalAdmin, 'acme'),
    /Cross-tenant administration denied/,
  )
})

test('PrincipalAdminService: separation of duties prevents modifying own record', async () => {
  const store = new InMemoryPrincipalStore()
  const svc = new PrincipalAdminService({ store })

  await assert.rejects(
    svc.setPrincipalRoles(admin, 'acme', admin.id, ['tenant-admin', 'supervisor']),
    /Separation of duties: administrators cannot grant or modify their own roles/,
  )
})

test('PrincipalAdminService: agents cannot be assigned authority roles', async () => {
  const store = new InMemoryPrincipalStore()
  const svc = new PrincipalAdminService({ store })

  const agent: Principal = {
    id: 'agent:worker-1',
    kind: 'agent',
    tenantId: 'acme',
    roles: ['supervisor'],
  }

  await assert.rejects(
    svc.createPrincipal(admin, agent),
    /Non-human principal "agent:worker-1" cannot be assigned role "supervisor" with authority permissions/,
  )
})

test('PrincipalAdminService: creates, lists, updates, and audits principal mutations fail-closed', async () => {
  const store = new InMemoryPrincipalStore()
  const auditEntries: PrincipalAdminAuditEntry[] = []
  const svc = new PrincipalAdminService({
    store,
    auditSink: (e) => {
      auditEntries.push(e)
    },
  })

  const newDev: Principal = {
    id: 'user:dev1@acme.com',
    kind: 'human',
    tenantId: 'acme',
    roles: ['developer'],
    displayName: 'Developer One',
  }

  const created = await svc.createPrincipal(admin, newDev)
  assert.equal(created.id, 'user:dev1@acme.com')

  const list = await svc.listPrincipals(admin, 'acme')
  assert.equal(list.length, 1)
  assert.equal(list[0]?.id, 'user:dev1@acme.com')

  // Update roles
  const updated = await svc.setPrincipalRoles(admin, 'acme', 'user:dev1@acme.com', ['developer', 'operator'])
  assert.deepEqual(updated.roles, ['developer', 'operator'])

  // Disable principal
  const disabled = await svc.setPrincipalDisabled(admin, 'acme', 'user:dev1@acme.com', true)
  assert.equal(disabled.disabled, true)

  assert.equal(auditEntries.length, 3)
  assert.equal(auditEntries[0]?.action, 'create-principal')
  assert.equal(auditEntries[1]?.action, 'update-principal')
  assert.equal(auditEntries[2]?.action, 'disable-principal')

  // Fail-closed audit test: when audit fails, operation aborts
  const failAuditSvc = new PrincipalAdminService({
    store,
    auditSink: () => {
      throw new Error('Audit disk full')
    },
  })

  await assert.rejects(
    failAuditSvc.setPrincipalDisabled(admin, 'acme', 'user:dev1@acme.com', false),
    /Audit sink failure; administrative mutation aborted/,
  )
})
