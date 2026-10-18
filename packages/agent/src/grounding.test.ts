/**
 * The grounding guard.
 *
 * The headline case is not synthetic: it is what llama3.2:3b actually returned from stage
 * 2 — schema-valid, zero tool calls, every id invented. That output is reproduced verbatim
 * below so the guard is tested against the real failure shape rather than a tidier one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { collectIds, groundActions, instrumentTools, type ActionReferences } from './grounding.ts'

const INVENTED: ActionReferences = {
  description: 'Search for CNC 3 controller entity',
  actorId: 'entity-cnc-3-controller',
  capabilityId: 'cap-entity-cnc-3-controller',
  applicablePolicyIds: ['policy-cnc-3-controller-param-change'],
  evidenceIds: ['evidence-cnc-3-controller-param-change'],
}

test('an action citing only invented ids is rejected when nothing was retrieved', () => {
  // The measured failure: toolCalls=0, so the grounding set is empty.
  const result = groundActions([INVENTED], new Set<string>())
  assert.equal(result.grounded.length, 0)
  assert.equal(result.rejected.length, 1)
  assert.deepEqual(result.rejected[0]!.ungrounded.sort(), [
    'cap-entity-cnc-3-controller',
    'entity-cnc-3-controller',
    'evidence-cnc-3-controller-param-change',
    'policy-cnc-3-controller-param-change',
  ])
})

test('an action passes once every id it cites appears in a tool result', () => {
  const grounded = new Set([
    'entity-engineering-agent',
    'cap-process-param',
    'policy-production-parameter-changes',
    'evidence-report-847',
  ])
  const result = groundActions(
    [{
      description: 'Increase the parameter under change control',
      actorId: 'entity-engineering-agent',
      capabilityId: 'cap-process-param',
      applicablePolicyIds: ['policy-production-parameter-changes'],
      evidenceIds: ['evidence-report-847'],
    }],
    grounded,
  )
  assert.equal(result.grounded.length, 1)
  assert.equal(result.rejected.length, 0)
})

test('one invented id disqualifies the whole action', () => {
  // All-or-nothing per action. A real actor with an invented capability is precisely the
  // case that yields a confidently wrong authorization, so it must not survive.
  const result = groundActions(
    [{
      description: 'mostly grounded but cites a capability that was never retrieved',
      actorId: 'entity-engineering-agent',
      capabilityId: 'cap-does-not-exist',
      applicablePolicyIds: [],
      evidenceIds: [],
    }],
    new Set(['entity-engineering-agent']),
  )
  assert.equal(result.grounded.length, 0)
  assert.deepEqual(result.rejected[0]!.ungrounded, ['cap-does-not-exist'])
})

test('a good action is kept alongside a rejected one rather than failing everything', () => {
  const result = groundActions(
    [
      INVENTED,
      {
        description: 'grounded',
        actorId: 'entity-engineering-agent',
        capabilityId: 'cap-process-param',
        applicablePolicyIds: [],
        evidenceIds: [],
      },
    ],
    new Set(['entity-engineering-agent', 'cap-process-param']),
  )
  assert.equal(result.grounded.length, 1)
  assert.equal(result.grounded[0]!.description, 'grounded')
  assert.equal(result.rejected.length, 1)
})

test('ids are collected from nested tool results, not just the top level', () => {
  const ids = collectIds({
    rows: [{ _id: 'entity-engineering-agent' }],
    meta: { nested: { deeper: [{ id: 'cap-process-param' }] } },
  })
  assert.ok(ids.has('entity-engineering-agent'))
  assert.ok(ids.has('cap-process-param'))
})

test('free prose that merely looks id-like is not treated as an id', () => {
  // A too-loose pattern would let a model pass validation by echoing strings it wrote in a
  // description, which is the same failure with a fig leaf.
  const ids = collectIds({ note: 'we should check the policy-production first, then act' })
  assert.equal(ids.size, 0)
})

test('unknown id prefixes are not accepted as grounding evidence', () => {
  const ids = collectIds({ _id: 'widget-123', other: 'totally-made-up' })
  assert.equal(ids.size, 0)
})

test('instrumented tools feed the index and still return their result', async () => {
  const grounded = new Set<string>()
  const tools = {
    searchEntities: {
      description: 'find entities',
      execute: async () => ({ rows: [{ _id: 'entity-engineering-agent', name: 'Engineering' }] }),
    },
    broken: {
      description: 'always fails',
      execute: async () => {
        throw new Error('nope')
      },
    },
  }
  const wrapped = instrumentTools(tools, grounded)

  const result = await (wrapped.searchEntities as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute({}, {})
  assert.deepEqual(result, { rows: [{ _id: 'entity-engineering-agent', name: 'Engineering' }] })
  assert.ok(grounded.has('entity-engineering-agent'), 'the retrieved id must be indexed')

  // A tool that throws must keep throwing — the wrapper must not swallow a failure and
  // present it as a successful, empty lookup.
  await assert.rejects(
    () => (wrapped.broken as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute({}, {}),
    /nope/,
  )
})

test('tools without an execute function pass through untouched', () => {
  const grounded = new Set<string>()
  const wrapped = instrumentTools({ plain: { description: 'no executor' } }, grounded)
  assert.deepEqual(wrapped.plain, { description: 'no executor' })
  assert.equal(grounded.size, 0)
})

test('the evidence sink captures the records themselves, labelled by tool', async () => {
  // Stage 2b runs with NO tools, so the proposing call sees the retrieved records only if
  // they are carried across here. Without this the model reasons about ids it has never
  // seen, which is the failure the 2a/2b split exists to prevent.
  const grounded = new Set<string>()
  const evidence: string[] = []
  const wrapped = instrumentTools(
    {
      searchEntities: {
        description: 'find entities',
        execute: async () => [{ _id: 'entity-engineering-agent', name: 'Engineering Agent' }],
      },
    },
    grounded,
    evidence,
  )
  await (wrapped.searchEntities as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute({}, {})
  assert.equal(evidence.length, 1)
  assert.match(evidence[0]!, /^\[searchEntities\] /)
  assert.match(evidence[0]!, /entity-engineering-agent/)
})

test('evidence is bounded so a large result cannot blow the next prompt', async () => {
  const grounded = new Set<string>()
  const evidence: string[] = []
  const wrapped = instrumentTools(
    { dump: { description: 'returns a lot', execute: async () => 'x'.repeat(50_000) } },
    grounded,
    evidence,
  )
  await (wrapped.dump as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute({}, {})
  assert.ok(evidence[0]!.length < 3000, `evidence was ${evidence[0]!.length} chars`)
})

test('a result that cannot be stringified is dropped rather than becoming "undefined"', () => {
  // A circular tool result must not throw mid-plan and take the whole planner down.
  const grounded = new Set<string>()
  const evidence: string[] = []
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const wrapped = instrumentTools({ weird: { description: 'circular', execute: async () => circular } }, grounded, evidence)
  return (wrapped.weird as { execute: (a: unknown, o: unknown) => Promise<unknown> })
    .execute({}, {})
    .then(() => {
      assert.deepEqual(evidence, [], 'an unrenderable result must not leave a bare tool label behind')
      assert.equal(grounded.size, 0)
    })
})