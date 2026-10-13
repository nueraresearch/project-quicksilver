import { createHash, randomUUID } from 'node:crypto'

export type TraceSource = 'query' | 'plan' | 'workflow' | 'decision' | 'agent' | 'queue' | 'schedule' | 'webhook'
export type TraceKind = 'request' | 'model' | 'tool' | 'evaluation' | 'decision' | 'workflow'
export type TraceStatus = 'ok' | 'error' | 'blocked'

/**
 * Deliberately excludes prompts, outputs, raw payloads, secrets, and arbitrary headers.
 * Adheres to telemetry-trace-span schema.
 */
export interface TraceSpanInput {
  traceId: string
  spanId?: string
  parentSpanId?: string | null
  source: TraceSource
  kind: TraceKind
  name: string
  status: TraceStatus
  startedAt: number
  durationMs: number
  requestedBy: string
  runId?: string | null
  workflowId?: string | null
  decisionId?: string | null
  agentId?: string | null
  modelId?: string | null
  toolName?: string | null
  toolSucceeded?: boolean | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  estimatedCostUsd?: number | null
  safetyDecision?: 'ALLOW' | 'BLOCK' | 'ESCALATE' | null
}

export interface TraceSpan extends TraceSpanInput {
  spanId: string
  parentSpanId: string | null
  runId: string | null
  workflowId: string | null
  decisionId: string | null
  agentId: string | null
  modelId: string | null
  toolName: string | null
  toolSucceeded: boolean | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  estimatedCostUsd: number | null
}

export interface TraceSpanDocument extends Omit<TraceSpan, 'startedAt'> {
  _id: string
  _type: 'telemetryTraceSpan'
  tenantId: string
  startedAt: string
  completedAt: string
}

export function buildHostTraceSpan(input: TraceSpanInput, tenantId = 'default'): TraceSpanDocument {
  if (!input || typeof input !== 'object' || !/^[a-f0-9-]{16,64}$/i.test(input.traceId)) {
    throw new Error('Trace id is invalid.')
  }
  const validSources = ['query', 'plan', 'workflow', 'decision', 'agent', 'queue', 'schedule', 'webhook']
  if (!validSources.includes(input.source)) throw new Error('Trace source is invalid.')
  if (!['request', 'model', 'tool', 'evaluation', 'decision', 'workflow'].includes(input.kind)) throw new Error('Trace span kind is invalid.')
  if (!['ok', 'error', 'blocked'].includes(input.status)) throw new Error('Trace status is invalid.')
  if (typeof input.name !== 'string' || !/^[a-z][a-z0-9._:-]{0,95}$/i.test(input.name)) throw new Error('Trace span name is invalid.')
  if (!Number.isFinite(input.startedAt) || input.startedAt < 0 || Number.isNaN(new Date(input.startedAt).getTime()) || !Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 86_400_000) {
    throw new Error('Trace timing is invalid.')
  }
  if (typeof input.requestedBy !== 'string' || input.requestedBy.length < 1 || input.requestedBy.length > 256) throw new Error('Trace requester is invalid.')
  if (typeof tenantId !== 'string' || tenantId.length < 1 || tenantId.length > 128) throw new Error('Trace tenant is invalid.')

  const spanId = input.spanId ?? randomUUID()
  if (!/^[a-f0-9-]{16,64}$/i.test(spanId)) throw new Error('Span id is invalid.')
  const completedAt = new Date(input.startedAt + input.durationMs).toISOString()
  const id = createHash('sha256').update(`${tenantId}\0${input.traceId}\0${spanId}`).digest('hex')

  return {
    _id: `telemetry-span-${id}`,
    _type: 'telemetryTraceSpan',
    tenantId,
    traceId: input.traceId,
    spanId,
    parentSpanId: input.parentSpanId ?? null,
    source: input.source,
    kind: input.kind,
    name: input.name,
    status: input.status,
    startedAt: new Date(input.startedAt).toISOString(),
    completedAt,
    durationMs: Math.floor(input.durationMs),
    requestedBy: input.requestedBy,
    runId: input.runId ?? null,
    workflowId: input.workflowId ?? null,
    decisionId: input.decisionId ?? null,
    agentId: input.agentId ?? null,
    modelId: input.modelId ?? null,
    toolName: input.toolName ?? null,
    toolSucceeded: input.toolSucceeded ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    safetyDecision: input.safetyDecision ?? null,
  }
}

export type TraceSpanSink = (span: TraceSpanDocument) => Promise<void> | void

export interface HostTraceTracerOptions {
  tenantId: string
  sink?: TraceSpanSink
  now?: () => number
}

/**
 * Host observability tracer for queue, schedule, and webhook lifecycles.
 * Emits telemetryTraceSpan documents without payloads or secret values.
 */
export class HostTraceTracer {
  readonly tenantId: string
  readonly sink?: TraceSpanSink
  private readonly now: () => number

  constructor(options: HostTraceTracerOptions) {
    this.tenantId = options.tenantId
    this.sink = options.sink
    this.now = options.now ?? Date.now
  }

  async traceWebhook(params: {
    endpointId: string
    status: number
    deliveryId?: string
    runId?: string | null
    requestedBy?: string
    startedAt?: number
    durationMs?: number
  }): Promise<TraceSpanDocument | undefined> {
    if (!this.sink) return undefined
    const durationMs = params.durationMs ?? 0
    const startedAt = params.startedAt ?? (this.now() - durationMs)
    const spanStatus: TraceStatus = params.status < 400 ? 'ok' : params.status === 403 ? 'blocked' : 'error'

    // Name restricted to sanitized token [a-z][a-z0-9._:-]{0,95}
    const cleanEndpoint = params.endpointId.toLowerCase().replace(/[^a-z0-9._:-]/g, '_').slice(0, 70)
    const name = `webhook.${cleanEndpoint}`

    // Derive deterministic UUID-like or random UUID traceId
    const traceId = randomUUID()

    const doc = buildHostTraceSpan({
      traceId,
      source: 'webhook',
      kind: 'request',
      name,
      status: spanStatus,
      startedAt,
      durationMs,
      requestedBy: params.requestedBy ?? `webhook:${params.endpointId}`,
      runId: params.runId ?? null,
    }, this.tenantId)

    try {
      await this.sink(doc)
    } catch {
      // Trace emission should fail closed or never crash caller
    }
    return doc
  }

  async traceScheduleTick(params: {
    scheduleId: string
    slot: number
    outcome: 'enqueued' | 'deduplicated' | string
    runId?: string | null
    workflowId?: string | null
    requestedBy?: string
    startedAt?: number
    durationMs?: number
  }): Promise<TraceSpanDocument | undefined> {
    if (!this.sink) return undefined
    const durationMs = params.durationMs ?? 0
    const startedAt = params.startedAt ?? (this.now() - durationMs)
    const isOk = params.outcome === 'enqueued' || params.outcome === 'deduplicated'
    const isBlocked = params.outcome === 'forbidden'
    const spanStatus: TraceStatus = isOk ? 'ok' : isBlocked ? 'blocked' : 'error'

    const cleanSchedule = params.scheduleId.toLowerCase().replace(/[^a-z0-9._:-]/g, '_').slice(0, 70)
    const name = `schedule.${cleanSchedule}`
    const traceId = randomUUID()

    const doc = buildHostTraceSpan({
      traceId,
      source: 'schedule',
      kind: 'workflow',
      name,
      status: spanStatus,
      startedAt,
      durationMs,
      requestedBy: params.requestedBy ?? `schedule:${params.scheduleId}`,
      runId: params.runId ?? null,
      workflowId: params.workflowId ?? null,
    }, this.tenantId)

    try {
      await this.sink(doc)
    } catch {
      // Trace emission error ignored
    }
    return doc
  }

  async traceQueueRun(params: {
    runId: string
    workflowId: string
    status: string
    requestedBy?: string
    startedAt?: number
    durationMs?: number
  }): Promise<TraceSpanDocument | undefined> {
    if (!this.sink) return undefined
    const durationMs = params.durationMs ?? 0
    const startedAt = params.startedAt ?? (this.now() - durationMs)
    const spanStatus: TraceStatus = params.status === 'completed' ? 'ok' : (params.status === 'blocked' ? 'blocked' : 'error')

    const cleanWf = params.workflowId.toLowerCase().replace(/[^a-z0-9._:-]/g, '_').slice(0, 70)
    const name = `queue.dispatch.${cleanWf}`
    const traceId = randomUUID()

    const doc = buildHostTraceSpan({
      traceId,
      source: 'queue',
      kind: 'workflow',
      name,
      status: spanStatus,
      startedAt,
      durationMs,
      requestedBy: params.requestedBy ?? 'quicksilver-worker',
      runId: params.runId,
      workflowId: params.workflowId,
    }, this.tenantId)

    try {
      await this.sink(doc)
    } catch {
      // Trace emission error ignored
    }
    return doc
  }
}
