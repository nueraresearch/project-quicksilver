import { test } from 'node:test'
import assert from 'node:assert/strict'

import { HostTraceTracer, buildHostTraceSpan, type TraceSpanDocument, type TraceSpanInput } from './telemetry.ts'

const NOW = Date.parse('2026-10-13T12:00:00Z')

function baseInput(overrides: Partial<TraceSpanInput> = {}): TraceSpanInput {
  return {
    traceId: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    spanId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    source: 'queue',
    kind: 'workflow',
    name: 'queue.dispatch.nightly-close',
    status: 'ok',
    startedAt: NOW,
    durationMs: 12,
    requestedBy: 'principal:svc:quicksilver-host',
    ...overrides,
  }
}

function tracer(tenantId = 'tenant-a') {
  const emitted: TraceSpanDocument[] = []
  const t = new HostTraceTracer({
    tenantId,
    now: () => NOW,
    sink: (span: TraceSpanDocument) => {
      emitted.push(span)
    },
  })
  return { tracer: t, emitted }
}

test('an accepted queue dispatch is traced as ok, not as an error', async () => {
  const { tracer: t } = tracer()

  const enqueued = await t.traceQueueRun({ runId: 'run_1', workflowId: 'nightly-close', status: 'enqueued', requestedBy: 'principal:eng-1' })
  const deduplicated = await t.traceQueueRun({ runId: 'run_2', workflowId: 'nightly-close', status: 'deduplicated', requestedBy: 'principal:eng-1' })
  const completed = await t.traceQueueRun({ runId: 'run_3', workflowId: 'nightly-close', status: 'completed' })

  // host.ts passes 'enqueued' or 'deduplicated' on the accept path. A healthy
  // admission must not be recorded as a failed one, or every run reads as an
  // error in /monitoring/traces.
  assert.equal(enqueued?.status, 'ok', 'enqueued must be ok')
  assert.equal(deduplicated?.status, 'ok', 'deduplicated must be ok')
  assert.equal(completed?.status, 'ok', 'completed must be ok')
})

test('a refused or blocked queue dispatch is traced as blocked or error', async () => {
  const { tracer: t } = tracer()

  assert.equal((await t.traceQueueRun({ runId: 'r', workflowId: 'wf', status: 'blocked' }))?.status, 'blocked')
  // An authorization refusal is blocked, not an error, matching traceScheduleTick.
  assert.equal((await t.traceQueueRun({ runId: 'r', workflowId: 'wf', status: 'forbidden' }))?.status, 'blocked')
  assert.equal((await t.traceQueueRun({ runId: 'r', workflowId: 'wf', status: 'backpressure' }))?.status, 'error')
})

test('schedule slots and webhooks map their outcomes onto the same three statuses', async () => {
  const { tracer: t } = tracer()

  assert.equal((await t.traceScheduleTick({ scheduleId: 'nightly', slot: NOW, outcome: 'enqueued' }))?.status, 'ok')
  assert.equal((await t.traceScheduleTick({ scheduleId: 'nightly', slot: NOW, outcome: 'deduplicated' }))?.status, 'ok')
  assert.equal((await t.traceScheduleTick({ scheduleId: 'nightly', slot: NOW, outcome: 'forbidden' }))?.status, 'blocked')
  assert.equal((await t.traceScheduleTick({ scheduleId: 'nightly', slot: NOW, outcome: 'backpressure' }))?.status, 'error')

  assert.equal((await t.traceWebhook({ endpointId: 'stripe', status: 200 }))?.status, 'ok')
  assert.equal((await t.traceWebhook({ endpointId: 'stripe', status: 403 }))?.status, 'blocked')
  assert.equal((await t.traceWebhook({ endpointId: 'stripe', status: 500 }))?.status, 'error')
})

test('span names are sanitized and cannot smuggle arbitrary text', async () => {
  const { tracer: t } = tracer()

  const doc = await t.traceWebhook({ endpointId: 'Invoices AND Receipts/../../etc', status: 200 })
  assert.ok(doc)
  assert.equal(doc.name, 'webhook.invoices_and_receipts_.._.._etc')
  assert.ok(!doc.name.includes('/'), 'no path separators survive into the span name')
  assert.ok(!doc.name.includes(' '), 'no spaces survive into the span name')

  const long = await t.traceWebhook({ endpointId: 'e'.repeat(200), status: 200 })
  assert.ok(long && long.name.length <= 96, `span name stays bounded, got ${long?.name.length}`)
})

test('a span carries metadata only: no payload, header or secret field is retained', () => {
  const doc = buildHostTraceSpan(
    baseInput({
      // Extra properties a careless caller might attach must not survive.
      ...({ prompt: 'secret instructions', authorization: 'Bearer qs_token', payload: { card: '4111' } } as unknown as Partial<TraceSpanInput>),
    }),
    'tenant-a',
  )

  assert.equal(doc._type, 'telemetryTraceSpan')
  for (const banned of ['prompt', 'authorization', 'payload', 'headers', 'body', 'secret']) {
    assert.ok(!(banned in doc), `${banned} must not be persisted on a span`)
  }
  assert.equal(doc.tenantId, 'tenant-a')
  assert.equal(doc.startedAt, '2026-10-13T12:00:00.000Z')
  assert.equal(doc.completedAt, '2026-10-13T12:00:00.012Z')
  assert.equal(doc.durationMs, 12)
})

test('absent optional fields become explicit nulls rather than undefined', () => {
  const doc = buildHostTraceSpan(baseInput(), 'tenant-a')
  for (const field of ['runId', 'workflowId', 'decisionId', 'agentId', 'modelId', 'toolName', 'toolSucceeded', 'inputTokens', 'outputTokens', 'totalTokens', 'estimatedCostUsd', 'safetyDecision', 'parentSpanId'] as const) {
    assert.equal(doc[field], null, `${field} is null when unset`)
  }
})

test('two tenants never collide on a span id', () => {
  const a = buildHostTraceSpan(baseInput(), 'tenant-a')
  const b = buildHostTraceSpan(baseInput(), 'tenant-b')
  assert.notEqual(a._id, b._id, 'the same trace in two tenants must not share a document id')
  assert.equal(a.tenantId, 'tenant-a')
  assert.equal(b.tenantId, 'tenant-b')

  // Deterministic for the same tenant/trace/span triple.
  assert.equal(buildHostTraceSpan(baseInput(), 'tenant-a')._id, a._id)
})

test('malformed spans are refused rather than persisted', () => {
  const bad: [string, TraceSpanInput][] = [
    ['trace id is not uuid-shaped', baseInput({ traceId: 'not-a-valid-id' })],
    ['unknown source', baseInput({ source: 'rogue' as TraceSpanInput['source'] })],
    ['unknown kind', baseInput({ kind: 'rogue' as TraceSpanInput['kind'] })],
    ['unknown status', baseInput({ status: 'rogue' as TraceSpanInput['status'] })],
    ['name may not start with a separator', baseInput({ name: '-leading-dash' })],
    ['name may not contain spaces', baseInput({ name: 'queue dispatch' })],
    ['negative duration', baseInput({ durationMs: -1 })],
    ['duration beyond one day', baseInput({ durationMs: 86_400_001 })],
    ['non-numeric start', baseInput({ startedAt: Number.NaN })],
    ['empty requester', baseInput({ requestedBy: '' })],
    ['oversized requester', baseInput({ requestedBy: 'x'.repeat(257) })],
    ['malformed span id', baseInput({ spanId: 'short' })],
  ]
  for (const [why, input] of bad) assert.throws(() => buildHostTraceSpan(input, 'tenant-a'), /invalid/i, why)

  assert.throws(() => buildHostTraceSpan(baseInput(), ''), /tenant is invalid/i)
  assert.throws(() => buildHostTraceSpan(baseInput(), 'x'.repeat(129)), /tenant is invalid/i)
})

test('a failing sink never propagates into the traced caller', async () => {
  const failing = new HostTraceTracer({
    tenantId: 'tenant-a',
    now: () => NOW,
    sink: () => {
      throw new Error('sink unavailable')
    },
  })

  // Telemetry must not be able to take down the host's request or schedule path.
  const doc = await failing.traceQueueRun({ runId: 'run_1', workflowId: 'wf', status: 'enqueued' })
  assert.ok(doc, 'the span is still returned for inspection even when the sink fails')

  const rejecting = new HostTraceTracer({ tenantId: 'tenant-a', now: () => NOW, sink: async () => Promise.reject(new Error('sink unavailable')) })
  assert.ok(await rejecting.traceWebhook({ endpointId: 'stripe', status: 200 }))
})

test('with no sink configured the tracer emits nothing at all', async () => {
  const t = new HostTraceTracer({ tenantId: 'tenant-a', now: () => NOW })
  assert.equal(await t.traceQueueRun({ runId: 'run_1', workflowId: 'wf', status: 'enqueued' }), undefined)
  assert.equal(await t.traceScheduleTick({ scheduleId: 'nightly', slot: NOW, outcome: 'enqueued' }), undefined)
  assert.equal(await t.traceWebhook({ endpointId: 'stripe', status: 200 }), undefined)
})