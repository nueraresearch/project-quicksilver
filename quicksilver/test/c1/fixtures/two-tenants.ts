/**
 * The two-tenant fixture module (acceptance matrix §2.2).
 *
 * Tenant names are synthetic and fixed. Nothing here reads `.env`, a CMS
 * client, a model or vault configuration, so a suite that imports it cannot
 * satisfy a case by accident of the developer's environment.
 */
import { MemoryStore } from '../../../cms/store.ts'
import { createRepositories, type RepositoryMap } from '../../../cms/repositories.ts'

export const TENANT_A = 'tenant-a'
export const TENANT_B = 'tenant-b'
export const TENANTS = [TENANT_A, TENANT_B] as const

export type Tenant = (typeof TENANTS)[number]

/** Business keys both tenants receive, so a merge would be visible. */
export const COLLIDING_KEYS = {
  slug: 'shared-root',
  graphId: 'shared-graph',
  agentId: 'shared-agent',
  lineageId: 'shared-lineage',
} as const

export interface Fixture {
  store: MemoryStore
  repositories: RepositoryMap
}

/** A fresh, isolated store plus every constructed repository. */
export function freshFixture(): Fixture {
  const store = new MemoryStore()
  return { store, repositories: createRepositories(store) }
}

/** The environment keys a native path must never read for tenant or CMS. */
export const FORBIDDEN_ENV = [
  'QUICKSILVER_TENANT_ID',
  'SANITY_STUDIO_PROJECT_ID',
  'SANITY_STUDIO_DATASET',
  'SANITY_AUTH_TOKEN',
  'SANITY_READ_TOKEN',
  'SANITY_WRITE_TOKEN',
  'NEXT_PUBLIC_SANITY_PROJECT_ID',
  'NEXT_PUBLIC_SANITY_DATASET',
  'SANITY_DATASET_PUBLIC',
] as const

/** Clears the forbidden keys and returns a restore function. */
export function clearForbiddenEnv(): () => void {
  const saved = new Map<string, string | undefined>()
  for (const key of FORBIDDEN_ENV) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
