import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, fileURLToPath, join } from 'node:path'
import { test } from 'node:test'

import { resolvePersistentDataDir } from './persistence.ts'
import { parseHostConfig } from './config.ts'
import { buildGovernedMemory } from './governed-memory.ts'
import { taskSetup } from './tasks-setup.ts'

test('Postgres run store can use an explicitly mounted disk for auxiliary state', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'qs-persistence-'))
  const config = parseHostConfig({ tenantId: 'acme', store: { kind: 'postgres', urlEnv: 'DATABASE_URL' } })
  const dataDir = join(baseDir, 'data')
  assert.equal(resolvePersistentDataDir(config, baseDir, { QUICKSILVER_DATA_DIR: dataDir }), dataDir)

  const memory = buildGovernedMemory(config, dataDir)
  assert.equal(memory.persistent, true)
  assert.equal(memory.path, join(dataDir, 'acme', 'memory.json'))

  const tasks = taskSetup(config, { baseDir, env: { QUICKSILVER_DATA_DIR: dataDir } })
  assert.equal(tasks.dir, join(dataDir, 'tasks'))
  assert.equal(tasks.notes.some((note) => note.includes('Tasks and task clients are kept in memory')), false)
})

test('Postgres without an explicit data directory remains fail-visible rather than pretending disk is durable', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'qs-persistence-'))
  const config = parseHostConfig({ tenantId: 'acme', store: { kind: 'postgres', urlEnv: 'DATABASE_URL' } })
  assert.equal(resolvePersistentDataDir(config, baseDir, {}), undefined)
  assert.equal(buildGovernedMemory(config).persistent, false)
  assert.equal(taskSetup(config, { baseDir, env: {} }).dir, undefined)
})

test('Render maps Postgres auxiliary state and Genesis state to the mounted disk', () => {
  const repoRoot = resolveRepoRoot()
  const render = readFileSync(join(repoRoot, 'deploy/render.yaml'), 'utf8')
  assert.match(render, /key: QUICKSILVER_DATA_DIR\s+value: \/data\b/)
  assert.match(render, /key: QUICKSILVER_GENESIS_DIR\s+value: \/data\/genesis\b/)

  const baseDir = mkdtempSync(join(tmpdir(), 'qs-persistence-'))
  const config = parseHostConfig({ tenantId: 'acme', store: { kind: 'postgres', urlEnv: 'DATABASE_URL' } })
  const dataDir = resolvePersistentDataDir(config, baseDir, { QUICKSILVER_DATA_DIR: '/data' })
  assert.equal(dataDir, '/data')
  assert.equal(join(dataDir!, 'genesis'), join('/data', 'genesis'))
})

function resolveRepoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}
