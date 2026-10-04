/**
 * Capped list routes say when the cap actually cut the result: `truncated` is true only when at least one
 * more row exists beyond the cap, which the stores learn by fetching one extra row, never by guessing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./route-test-loader.mjs', import.meta.url)
const { capRows } = await import('./list-bounds.ts')
const { ENTITY_DIRECTORY_LIMIT, loadEntityDirectory } = await import('./entity-directory.ts')
const { listWorkflowExecutions, listWorkflowPublications } = await import('./workflow-publication-store.ts')

/** A read client over a fixed pool of rows that honors `[0...N]` and `[0...$limit]` the way GROQ does. */
function poolClient(pools: { match: RegExp; rows: unknown[] }[], seen: string[] = []) {
  return {
    seen,
    fetch: async (query: string, params: Record<string, unknown> = {}) => {
      seen.push(query)
      const pool = pools.find((candidate) => candidate.match.test(query))
      if (!pool) throw new Error(`Unhandled test query: ${query}`)
      const literal = /\[0\.\.\.(\d+)\]/.exec(query)
      const limit = literal ? Number(literal[1]) : typeof params.limit === 'number' ? params.limit : pool.rows.length
      return pool.rows.slice(0, limit)
    },
  }
}

test('capRows is truncated only when a row exists beyond the cap', () => {
  assert.deepEqual(capRows([1, 2, 3], 3), { rows: [1, 2, 3], truncated: false })
  assert.deepEqual(capRows([1, 2, 3, 4], 3), { rows: [1, 2, 3], truncated: true })
  assert.deepEqual(capRows([], 3), { rows: [], truncated: false })
})

const entity = (n: number) => ({ id: `entity-${n}`, name: `Entity ${n}`, entityType: 'human' })

function directoryClient(count: number) {
  return {
    fetch: async (query: string) => {
      const limit = Number(/\[0\.\.\.(\d+)\]/.exec(query)![1])
      return { total: count, entities: Array.from({ length: Math.min(count, limit) }, (_, n) => entity(n)) }
    },
  }
}

test('the company directory reports truncated:false at exactly the cap and true one row past it', async () => {
  const exact = await loadEntityDirectory(directoryClient(ENTITY_DIRECTORY_LIMIT) as never)
  assert.equal(exact.entities.length, ENTITY_DIRECTORY_LIMIT)
  assert.equal(exact.truncated, false)

  const over = await loadEntityDirectory(directoryClient(ENTITY_DIRECTORY_LIMIT + 1) as never)
  assert.equal(over.entities.length, ENTITY_DIRECTORY_LIMIT)
  assert.equal(over.total, ENTITY_DIRECTORY_LIMIT + 1)
  assert.equal(over.truncated, true)
})

test('the company directory keeps its total and never returns the probe row', async () => {
  const client = {
    fetch: async (query: string) => {
      assert.match(query, /\[0\.\.\.501\]/, 'asks for one row more than it returns')
      return { total: 3, entities: [entity(1), entity(2), entity(3)] }
    },
  }
  assert.deepEqual(await loadEntityDirectory(client as never), { total: 3, entities: [entity(1), entity(2), entity(3)], truncated: false })
})

const execution = (n: number) => ({ runId: `run-${n}`, workflowId: 'w1', version: 1, digest: 'd', requestedBy: 'entity-ana', status: 'completed', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', durationMs: 1000, evaluationCount: 0 })

test('workflow executions report truncated against the requested limit', async () => {
  const pool = Array.from({ length: 11 }, (_, n) => execution(n))
  const cut = await listWorkflowExecutions('w1', 10, poolClient([{ match: /workflowExecution/, rows: pool }]) as never)
  assert.equal(cut.executions.length, 10)
  assert.equal(cut.truncated, true)

  const exact = await listWorkflowExecutions('w1', 11, poolClient([{ match: /workflowExecution/, rows: pool }]) as never)
  assert.equal(exact.executions.length, 11)
  assert.equal(exact.truncated, false)

  const none = await listWorkflowExecutions('w1', 25, poolClient([{ match: /workflowExecution/, rows: [] }]) as never)
  assert.deepEqual(none, { executions: [], truncated: false })
})

const auditEvent = (n: number) => ({ event: 'reviewed', graphId: 'w1', version: n + 1, actorId: 'entity-ana', at: '2026-01-01T00:00:00.000Z', graphDigest: 'd' })

test('workflow publications report truncated when the audit trail passes its 100-event cap', async () => {
  const at = (count: number) => poolClient([
    { match: /automationWorkflow/, rows: [] },
    { match: /workflowPublicationAudit/, rows: Array.from({ length: count }, (_, n) => auditEvent(n)) },
  ])
  const exact = await listWorkflowPublications('w1', at(100) as never)
  assert.equal(exact.audit.length, 100)
  assert.equal(exact.truncated, false)

  const over = await listWorkflowPublications('w1', at(101) as never)
  assert.equal(over.audit.length, 100)
  assert.equal(over.truncated, true)
})

test('the pages that render a capped list say so when the server reports truncation', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const entities = read('../app/entities/page.tsx')
  assert.match(entities, /truncated/)
  assert.match(entities, /Showing the first \{entities\.length\} of \{total\} records; more exist/)
  const workflows = read('../app/workflows/page.tsx')
  assert.match(workflows, /publication\.truncated &&[^\n]*more exist/)
  assert.match(workflows, /executionsTruncated &&[^\n]*more exist/)
  const agents = read('../app/agents/page.tsx')
  assert.match(agents, /catalog\.truncated &&[^\n]*more exist/)
  assert.match(agents, /historyTruncated\[agent\.agentId\]/)
})
