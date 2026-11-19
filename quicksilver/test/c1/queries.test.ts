/**
 * Gate G — the six query contracts (matrix §9), C1-G01–C1-G07.
 *
 * Each contract has a fixture-backed positive case, a tenant-scope refusal or
 * empty result, and the ordering/refusal rule the schema map states. None of
 * these functions writes.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { C1_STORES } from '../../cms/catalog.ts'
import { RepositoryError } from '../../cms/errors.ts'
import {
  findContradictions,
  getCapabilityGraph,
  getDecisionHistory,
  getEvidenceForMetric,
  getObjectiveTree,
  getWorkflowDAG,
} from '../../cms/queries.ts'
import { digestOf } from '../../cms/store.ts'
import * as publicQuery from '../../query/index.ts'
import { FOREIGN_GRAPH, TENANT_A, TENANT_B, freshFixture, seededFixture } from './fixtures/two-tenants.ts'

function code(error: unknown): string | undefined {
  return error instanceof RepositoryError ? error.code : undefined
}

test('C1-G01 the capability graph is tenant-scoped, ordered, and refuses dangling edges and cycles', async () => {
  const { store, seeds } = seededFixture()
  const graph = await getCapabilityGraph(store, TENANT_A)
  const seed = seeds[TENANT_A]

  assert.deepEqual(graph.nodes.map((node) => node.id), [seed.capability, seed.capability2].sort())
  assert.deepEqual(graph.edges, [{ from: seed.capability, to: seed.capability2, kind: 'inherits' }])
  assert.ok(!graph.nodes.some((node) => node.id === seeds[TENANT_B].capability), 'B nodes never appear')

  // Positive control for the published-only filter: a draft and a tombstoned
  // capability are absent. Dropping the filter puts both in the graph.
  const published = store.rows('qs_capabilities').find((row) => row.id === seed.capability && row.tenant_id === TENANT_A)!
  const detached = { ...published, inherits_ids: [], requires_ids: [], conflicts_with_ids: [] }
  store.insert('qs_capabilities', { ...detached, id: 'cap_draft', lifecycle: 'draft' })
  store.insert('qs_capabilities', { ...detached, id: 'cap_gone', deleted_at: '2026-01-02T00:00:00.000Z' })
  const filtered = await getCapabilityGraph(store, TENANT_A)
  assert.ok(!filtered.nodes.some((node) => node.id === 'cap_draft'), 'a draft capability is not the published graph')
  assert.ok(!filtered.nodes.some((node) => node.id === 'cap_gone'), 'a tombstoned capability is not the published graph')

  const dangling = seededFixture()
  dangling.store.replace('qs_capabilities', TENANT_A, dangling.seeds[TENANT_A].capability2, { requires_ids: ['cap_missing'] })
  await assert.rejects(
    getCapabilityGraph(dangling.store, TENANT_A),
    (error: unknown) => code(error) === 'UnresolvedRelation',
    'a dangling edge refuses',
  )

  const cyclic = seededFixture()
  cyclic.store.replace('qs_capabilities', TENANT_A, cyclic.seeds[TENANT_A].capability2, {
    inherits_ids: [cyclic.seeds[TENANT_A].capability],
  })
  await assert.rejects(
    getCapabilityGraph(cyclic.store, TENANT_A),
    (error: unknown) => code(error) === 'UnresolvedRelation',
    'a cycle refuses',
  )
})

test('C1-G02 contradictions cover all three kinds, are ordered, tenant-scoped and capped', async () => {
  const { store } = freshFixture()
  const at = store.clock.now()
  const base = { tenant_id: TENANT_A, revision: 1, lifecycle: 'published', created_at: at, created_by: 'fixture', updated_at: at, updated_by: 'fixture' }
  store.insert('qs_policies', { ...base, id: 'pol_a', lineage_id: 'lineage-1', effect: 'allow', name: 'Allow' })
  store.insert('qs_policies', { ...base, id: 'pol_b', lineage_id: 'lineage-1', effect: 'deny', name: 'Deny' })
  store.insert('qs_evidence', { ...base, id: 'ev_a', contradicts_ids: ['ev_b'], title: 'A' })
  store.insert('qs_evidence', { ...base, id: 'ev_b', contradicts_ids: [], title: 'B' })
  // A stale projection: the row says 10, the latest observation says 16.
  store.insert('qs_metrics', { ...base, id: 'met_a', value: 10 })
  store.insert('qs_metric_observations', { tenant_id: TENANT_A, id: 'obs_1', metric_id: 'met_a', value: 10, observed_at: '2026-01-01T00:00:00.000Z' })
  store.insert('qs_metric_observations', { tenant_id: TENANT_A, id: 'obs_2', metric_id: 'met_a', value: 16, observed_at: '2026-01-02T00:00:00.000Z' })

  const findings = await findContradictions(store, TENANT_A)
  assert.deepEqual(findings.map((finding) => finding.kind), ['evidence-contradiction', 'metric-drift', 'policy-conflict'])
  assert.deepEqual(findings[0]?.subjectIds, ['ev_a', 'ev_b'])
  assert.ok(!JSON.stringify(findings).includes(TENANT_B), 'no foreign id appears')
  assert.deepEqual(
    findings.map((finding) => `${finding.kind}\u0000${finding.id}`),
    findings.map((finding) => `${finding.kind}\u0000${finding.id}`).slice().sort(),
    'ordered by (kind, id)',
  )

  // Cross the 200-finding cap without changing the tenant.
  for (let index = 0; index < 105; index += 1) {
    store.insert('qs_evidence', {
      ...base,
      id: `ev_bulk_${index}`,
      contradicts_ids: ['ev_a', 'ev_b'],
      title: `Bulk ${index}`,
    })
  }
  const capped = await findContradictions(store, TENANT_A)
  assert.equal(capped.length, 200, 'findings are capped at 200')
})

test('C1-G03 the workflow DAG resolves only an active same-tenant version and refuses a malformed graph', async () => {
  const { store, seeds } = seededFixture()
  const dag = await getWorkflowDAG(store, TENANT_A, 'shared-graph')
  assert.ok(dag)
  assert.equal(dag.version, 1)
  assert.equal(dag.entryNodeId, 'start')
  assert.deepEqual(dag.nodes.map((node) => node.id), ['end', 'start'])
  assert.equal((await getWorkflowDAG(store, TENANT_A, FOREIGN_GRAPH)), null, 'a foreign graph is null')
  assert.equal((await getWorkflowDAG(store, TENANT_A, 'no-such-graph')), null)

  const unpublished = seededFixture()
  const version = unpublished.store.rawDump(TENANT_A, 'qs_automation_workflows').find((row) => row.version === 1)!
  unpublished.store.insert('qs_automation_workflows', {
    ...version,
    id: 'wf_draft_version',
    version: 2,
    lifecycle: 'draft',
    digest: digestOf({ ...version, version: 2 }),
  })
  unpublished.store.replace('qs_workflow_publication_heads', TENANT_A, unpublished.seeds[TENANT_A].workflowHead, {
    active_version: 2,
  })
  assert.equal(await getWorkflowDAG(unpublished.store, TENANT_A, 'shared-graph'), null, 'no draft fallback')

  const stale = seededFixture()
  stale.store.replace('qs_automation_workflows', TENANT_A, String(version.id), { deleted_at: '2026-01-02T00:00:00.000Z' })
  assert.equal(await getWorkflowDAG(stale.store, TENANT_A, 'shared-graph'), null, 'a tombstoned version is not served')

  const malformed = seededFixture()
  malformed.store.replace('qs_automation_workflows', TENANT_A, String(version.id), {
    nodes: [
      { id: 'start', kind: 'entry', label: 'Start', config: null },
      { id: 'start', kind: 'task', label: 'Duplicate', config: null },
    ],
  })
  await assert.rejects(
    getWorkflowDAG(malformed.store, TENANT_A, 'shared-graph'),
    (error: unknown) => code(error) === 'MalformedQuery',
    'duplicate node ids refuse',
  )

  const cyclic = seededFixture()
  cyclic.store.replace('qs_automation_workflows', TENANT_A, String(version.id), {
    nodes: [
      { id: 'start', kind: 'entry', label: 'Start', config: null },
      { id: 'end', kind: 'task', label: 'End', config: null },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'end' },
      { id: 'e2', from: 'end', to: 'start' },
    ],
  })
  await assert.rejects(
    getWorkflowDAG(cyclic.store, TENANT_A, 'shared-graph'),
    (error: unknown) => code(error) === 'MalformedQuery',
    'a cycle refuses',
  )

})

test('C1-G04 the objective tree is deterministic, tenant-scoped and refuses orphan and cycle edges', async () => {
  const { store, seeds } = seededFixture()
  const tree = await getObjectiveTree(store, TENANT_A)
  assert.equal(tree.roots.length, 1)
  assert.equal(tree.roots[0]?.id, seeds[TENANT_A].objective)
  assert.equal(tree.roots[0]?.children.length, 1)
  assert.equal(tree.roots[0]?.children[0]?.id, seeds[TENANT_A].objectiveChild)
  assert.deepEqual(await getObjectiveTree(store, TENANT_A, seeds[TENANT_B].objective), { roots: [], truncated: false })

  const orphan = seededFixture()
  orphan.store.replace('qs_objectives', TENANT_A, orphan.seeds[TENANT_A].objectiveChild, { parent_id: 'obj_missing' })
  await assert.rejects(
    getObjectiveTree(orphan.store, TENANT_A),
    (error: unknown) => code(error) === 'UnresolvedRelation',
    'an orphan parent refuses',
  )

  const cyclic = seededFixture()
  cyclic.store.replace('qs_objectives', TENANT_A, cyclic.seeds[TENANT_A].objectiveChild, {
    child_ids: [cyclic.seeds[TENANT_A].objective],
  })
  await assert.rejects(
    getObjectiveTree(cyclic.store, TENANT_A),
    (error: unknown) => code(error) === 'UnresolvedRelation',
    'a cycle refuses',
  )

  // A chain deeper than the 32-level bound sets truncated instead of looping.
  const deep = freshFixture()
  const at = deep.store.clock.now()
  const base = { tenant_id: TENANT_A, revision: 1, lifecycle: 'published', created_at: at, created_by: 'fixture', updated_at: at, updated_by: 'fixture', status: 'active', owner_id: null, department_id: null }
  for (let index = 0; index < 40; index += 1) {
    deep.store.insert('qs_objectives', {
      ...base,
      id: `obj_deep_${index}`,
      name: `Deep ${String(index).padStart(2, '0')}`,
      parent_id: index === 0 ? null : `obj_deep_${index - 1}`,
      child_ids: index === 39 ? [] : [`obj_deep_${index + 1}`],
    })
  }
  const bounded = await getObjectiveTree(deep.store, TENANT_A)
  assert.equal(bounded.truncated, true, 'the depth bound sets truncated')
  assert.equal(bounded.roots.length, 1)
})

test('C1-G05 metric evidence is direct, newest-first, tombstone-free and bounded', async () => {
  const { store, seeds } = seededFixture()
  const metricId = seeds[TENANT_A].metric

  const evidence = await getEvidenceForMetric(store, TENANT_A, metricId)
  assert.deepEqual(evidence.map((row) => row.id), [seeds[TENANT_A].evidence, seeds[TENANT_A].evidence2])

  const limited = await getEvidenceForMetric(store, TENANT_A, metricId, { limit: 1 })
  assert.equal(limited.length, 1)

  const tombstoned = seededFixture()
  tombstoned.store.replace('qs_evidence', TENANT_A, tombstoned.seeds[TENANT_A].evidence2, { deleted_at: '2026-01-02T00:00:00.000Z' })
  assert.deepEqual(
    (await getEvidenceForMetric(tombstoned.store, TENANT_A, metricId)).map((row) => row.id),
    [tombstoned.seeds[TENANT_A].evidence],
    'a tombstoned row is excluded',
  )

  assert.deepEqual(await getEvidenceForMetric(store, TENANT_A, seeds[TENANT_B].metric), [], 'a foreign metric is empty')
  await assert.rejects(
    getEvidenceForMetric(store, TENANT_A, metricId, { limit: 0 }),
    (error: unknown) => code(error) === 'MalformedQuery',
  )
})

test('C1-G06 decision history serves A only and refuses invalid filters', async () => {
  const { store, seeds } = seededFixture()
  const history = await getDecisionHistory(store, TENANT_A, { decisionId: seeds[TENANT_A].decision })
  assert.equal(history.events.length, 1)
  assert.equal(history.events[0]?.prevHash, null)

  assert.deepEqual(
    (await getDecisionHistory(store, TENANT_A, { decisionId: seeds[TENANT_B].decision })).events,
    [],
    'a foreign decision has no events',
  )

  await assert.rejects(
    getDecisionHistory(store, TENANT_A, { cursor: 'garbage' }),
    (error: unknown) => code(error) === 'MalformedQuery',
  )
  await assert.rejects(
    getDecisionHistory(store, TENANT_A, { status: ['unknown'] }),
    (error: unknown) => code(error) === 'MalformedQuery',
  )
  await assert.rejects(
    getDecisionHistory(store, TENANT_A, { from: 'not-a-date' }),
    (error: unknown) => code(error) === 'MalformedQuery',
  )
  await assert.rejects(
    getDecisionHistory(store, TENANT_A, { kind: 'other' as never }),
    (error: unknown) => code(error) === 'MalformedQuery',
  )
})

test('C1-G07 all six contracts exist, return their typed shape, and have a refusal or empty case', async () => {
  const { store, seeds } = seededFixture()
  const contracts = [
    ['capabilityGraph', () => getCapabilityGraph(store, TENANT_A)],
    ['contradictions', () => findContradictions(store, TENANT_A)],
    ['workflowDAG', () => getWorkflowDAG(store, TENANT_A, 'shared-graph')],
    ['objectiveTree', () => getObjectiveTree(store, TENANT_A)],
    ['evidenceForMetric', () => getEvidenceForMetric(store, TENANT_A, seeds[TENANT_A].metric)],
    ['decisionHistory', () => getDecisionHistory(store, TENANT_A, { decisionId: seeds[TENANT_A].decision })],
  ] as const

  for (const [name, run] of contracts) {
    const result = await run()
    assert.notEqual(result, undefined, `${name} returns a value`)
    assert.ok(Array.isArray(result) || typeof result === 'object', `${name} is not a stub`)
  }

  assert.deepEqual(await getObjectiveTree(store, TENANT_A, seeds[TENANT_B].objective), { roots: [], truncated: false })
  assert.deepEqual(await getEvidenceForMetric(store, TENANT_A, seeds[TENANT_B].metric), [])
  assert.equal(await getWorkflowDAG(store, TENANT_A, FOREIGN_GRAPH), null)
  assert.deepEqual((await getDecisionHistory(store, TENANT_A, { decisionId: seeds[TENANT_B].decision })).events, [])
})

test('C1-G07 the public entry points execute the contracts and no stub remains', async () => {
  const { store, seeds } = seededFixture()
  const snapshot = () => digestOf(C1_STORES.map(({ name }) => store.rawDump(TENANT_A, name)))
  const before = snapshot()
  const contracts: Array<[string, () => Promise<number>]> = [
    ['getCapabilityGraph', async () => (await publicQuery.getCapabilityGraph(store, TENANT_A)).nodes.length],
    ['findContradictions', async () => (await publicQuery.findContradictions(store, TENANT_A)).length],
    ['getWorkflowDAG', async () => (await publicQuery.getWorkflowDAG(store, TENANT_A, 'shared-graph'))?.nodes.length ?? 0],
    ['getObjectiveTree', async () => (await publicQuery.getObjectiveTree(store, TENANT_A)).roots.length],
    ['getEvidenceForMetric', async () => (await publicQuery.getEvidenceForMetric(store, TENANT_A, seeds[TENANT_A].metric)).length],
    ['getDecisionHistory', async () => (await publicQuery.getDecisionHistory(store, TENANT_A, { decisionId: seeds[TENANT_A].decision })).events.length],
  ]

  for (const [name, size] of contracts) {
    assert.ok((await size()) >= 1, `${name} returns fixture-backed data, not an empty stub`)
  }

  // Positive control for "not a stub": an unconditional empty result would pass
  // the checks above only if the fixture were empty, but it could not refuse.
  await assert.rejects(
    publicQuery.getCapabilityGraph(store, '   '),
    (error: unknown) => code(error) === 'MalformedQuery',
    'the public entry point still refuses a blank tenant',
  )
  assert.deepEqual(await publicQuery.getEvidenceForMetric(store, TENANT_A, seeds[TENANT_B].metric), [])

  assert.equal(snapshot(), before, 'the six contracts write nothing')

  const source = readFileSync(new URL('../../query/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bTODO\b|not implemented/i, 'no query entry point may remain a stub')
})
