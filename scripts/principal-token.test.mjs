import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

const run = (...args) => spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/principal-token.ts', ...args], { encoding: 'utf8', env: { ...process.env, QUICKSILVER_TENANT_ID: 'nuera' } })

function parse(output) {
  const token = /\n\s+(qs_\S+)\n/.exec(output)?.[1]
  const entry = JSON.parse(/\n\s+(\{.*\})\s*$/m.exec(output)[1])
  return { token, entry }
}

test('a human token is the default, and the digest matches the token', () => {
  const r = run('entity-sarah-chen')
  assert.equal(r.status, 0, r.stderr)
  const { token, entry } = parse(r.stdout)
  assert.equal(entry.kind, 'human')
  assert.deepEqual(entry.roles, ['supervisor'])
  assert.equal(entry.tenantId, 'nuera')
  assert.equal(entry.tokenDigest, `sha256:${createHash('sha256').update(token).digest('hex')}`)
})

test('--kind agent makes an agent entity that holds the agent-worker role', () => {
  const r = run('entity-engineering-agent', '--kind', 'agent')
  assert.equal(r.status, 0, r.stderr)
  const { entry } = parse(r.stdout)
  assert.equal(entry.kind, 'agent')
  assert.deepEqual(entry.roles, ['agent-worker'])
  assert.ok(!r.stdout.includes('"token"'), 'the entry holds only the digest')
})

test('an unknown kind is refused', () => {
  const r = run('entity-x', '--kind', 'robot')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /--kind must be/)
})
