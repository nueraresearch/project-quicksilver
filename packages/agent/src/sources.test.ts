import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeSources } from './sources.ts'
import { summarizeToolCall } from './mcp.ts'

test('sources: knowledge-base reads, dataset queries and app pages are told apart, with the detail of the call', () => {
  const out = describeSources([
    { name: 'kb_initial_context', succeeded: true },
    { name: 'knowledge_base_read', succeeded: true, detail: 'policy-refund-limits' },
    { name: 'groq_query', succeeded: true, detail: '*[_type=="decision"]{status}' },
    { name: 'list_decisions', succeeded: true },
    { name: 'mystery_tool', succeeded: false },
  ])
  assert.deepEqual(out.map((s) => s.kind), ['schema', 'knowledge-base', 'dataset-query', 'app', 'other'])
  assert.equal(out[1]!.detail, 'policy-refund-limits')
  assert.equal(out[3]!.label, 'Decisions')
  assert.equal(out[4]!.succeeded, false)
})

test('sources: the same call twice is listed once, different details are kept, and the list is bounded', () => {
  const same = describeSources([{ name: 'groq_query', succeeded: true, detail: 'a' }, { name: 'groq_query', succeeded: true, detail: 'a' }, { name: 'groq_query', succeeded: true, detail: 'b' }])
  assert.equal(same.length, 2)
  const many = describeSources(Array.from({ length: 60 }, (_, i) => ({ name: 'groq_query', succeeded: true, detail: `q${i}` })))
  assert.equal(many.length, 20)
})

test('call summaries use the query or entry, skip anything credential-shaped, and are bounded', () => {
  assert.equal(summarizeToolCall({ query: '*[_type == "policy"]' }), '*[_type == "policy"]')
  assert.equal(summarizeToolCall({ apiKey: 'sk-should-not-show', id: 'entry-7' }), 'entry-7')
  assert.equal(summarizeToolCall({ token: 'nope', authorization: 'nope' }), undefined)
  assert.equal(summarizeToolCall(null), undefined)
  assert.equal(summarizeToolCall({ n: 5 }), undefined)
  assert.equal(summarizeToolCall({ query: 'x'.repeat(500) })!.length, 240)
  assert.equal(summarizeToolCall({ query: 'a\n  b   c' }), 'a b c')
})
