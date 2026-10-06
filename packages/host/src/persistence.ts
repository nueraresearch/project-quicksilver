import { isAbsolute, resolve } from 'node:path'

import type { HostConfig } from './config.ts'

/**
 * Resolve durable host data that is not a workflow run. The run store may be
 * Postgres while these single-tenant auxiliary stores use a mounted disk.
 *
 * `QUICKSILVER_DATA_DIR` is intentionally explicit: without it a Postgres
 * deployment does not silently write to an ephemeral container filesystem.
 */
export function resolvePersistentDataDir(
  config: Pick<HostConfig, 'store'>,
  baseDir: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const configured = env.QUICKSILVER_DATA_DIR?.trim()
  if (configured) return isAbsolute(configured) ? configured : resolve(baseDir, configured)
  if (config.store.kind === 'file') return resolve(config.store.path, '..')
  return undefined
}
