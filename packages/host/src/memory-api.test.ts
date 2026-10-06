import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '@quicksilver/kernel'
import type { Principal } from '@quicksilver/kernel/identity'
import { handleMemoryRoute } from './memory-api.ts'

const human: Principal = { id: 'user:owner@example.test', kind: 'human', tenantId: 'tenant-a', roles: ['supervisor'] }
const service: Principal = { id: 'svc:automation', kind: 'service', tenantId: 'tenant-a', roles: ['trigger'] }
const decisionId = 'decision-existing-1'
const body = (value: unknown) => async () => ({ ok: true as const, value })

test('memory API refuses missing decision provenance and behavior-changing memory', async () => {
  const store = new MemoryStore()
  const calls: string[] = []
  const deps = { store, decisionExists: async (id: string) => { calls.push(id); return id === decisionId }, now: () => 1_000 }
  const base = { method: 'POST', parts: ['api', 'memory'], principal: human, readBody: body({ id: 'lesson-1', kind: 'domain-pattern', domain: 'agent:reviewer', content: 'Prefer cited evidence.', sourceDecisionId: 'missing' }) }
  assert.equal((await handleMemoryRoute(base, deps))?.status, 422)
  assert.deepEqual(calls, ['missing'])
  const behaviorChange = await handleMemoryRoute({ ...base, readBody: body({ id: 'rule-1', kind: 'routing-rule', domain: 'agent:reviewer', content: 'Always route here.', sourceDecisionId: decisionId }) }, deps)
  assert.equal(behaviorChange?.status, 422)
  assert.equal(store.events().at(-1)?.event, 'refused')
  assert.equal(store.entries().length, 0)
})

test('memory API persists only governed entries with an existing same-tenant decision source', async () => {
  const store = new MemoryStore()
  const deps = { store, decisionExists: async (id: string) => id === decisionId, now: () => 1_000 }
  const create = await handleMemoryRoute({
    method: 'POST', parts: ['api', 'memory'], principal: human,
    readBody: body({ id: 'lesson-1', kind: 'domain-pattern', domain: 'agent:reviewer', content: 'Prefer cited evidence.', sourceDecisionId: decisionId, confidence: 0.9, retentionDays: 30 }),
  }, deps)
  assert.equal(create?.status, 201)
  assert.equal(store.entries()[0]?.source, `decision:${decisionId}`)
  assert.deepEqual(store.entries()[0]?.proposedBy, { id: human.id, kind: 'human' })

  const listed = await handleMemoryRoute({ method: 'GET', parts: ['api', 'memory'], principal: human, query: new URLSearchParams('domain=agent%3Areviewer'), readBody: body({}) }, deps)
  assert.equal(listed?.status, 200)
  assert.deepEqual((listed?.body as { memories: Array<{ id: string }> }).memories.map((entry) => entry.id), ['lesson-1'])

  const forgotten = await handleMemoryRoute({ method: 'POST', parts: ['api', 'memory', 'lesson-1', 'forget'], principal: human, readBody: body({}) }, deps)
  assert.equal(forgotten?.status, 200)
  assert.equal(store.entries().length, 0)
  assert.equal(store.events().at(-1)?.event, 'forgotten')
})

test('memory API refuses non-human writes and forgets even with a well-formed body', async () => {
  const store = new MemoryStore()
  const deps = { store, decisionExists: async () => true, now: () => 1_000 }
  const write = await handleMemoryRoute({
    method: 'POST', parts: ['api', 'memory'], principal: service,
    readBody: body({ id: 'lesson-1', kind: 'domain-pattern', domain: 'agent:reviewer', content: 'text', sourceDecisionId: decisionId }),
  }, deps)
  const forget = await handleMemoryRoute({ method: 'POST', parts: ['api', 'memory', 'lesson-1', 'forget'], principal: service, readBody: body({}) }, deps)
  assert.equal(write?.status, 403)
  assert.equal(forget?.status, 403)
})

test('memory API rejects sensitive content through the memory governor and validates filters', async () => {
  const store = new MemoryStore()
  const deps = { store, decisionExists: async () => true }
  const result = await handleMemoryRoute({
    method: 'POST', parts: ['api', 'memory'], principal: human,
    readBody: body({ id: 'lesson-sensitive', kind: 'domain-pattern', domain: 'general', content: 'password=do-not-store', sourceDecisionId: decisionId }),
  }, deps)
  assert.equal(result?.status, 422)
  const filter = await handleMemoryRoute({ method: 'GET', parts: ['api', 'memory'], principal: human, query: new URLSearchParams('kind=bogus'), readBody: body({}) }, deps)
  assert.equal(filter?.status, 400)
  assert.equal(store.entries().length, 0)
})
