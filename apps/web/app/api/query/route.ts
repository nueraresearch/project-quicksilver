/**
 * POST /api/query — run a single question against the Quicksilver query agent.
 *
 * Request body: { question: string }
 * Response:     QueryResult (see @quicksilver/agent)
 */

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { safeErrorName } from '@/lib/safe-log'
import { estimateModelCostUsd, executeGovernedAgent, queryQuicksilverAgent } from '@quicksilver/agent'
import { persistEvaluations } from '@/lib/evaluation-store'
import { guardWebRoute } from '@/lib/route-guard'
import { requireWebAgentProfile, webAgentMemoryFor } from '@/lib/agent-profiles'
import { persistTraceSpans } from '@/lib/telemetry-store'
import type { TraceSpanInput } from '@/lib/telemetry'

export async function POST(req: Request) {
  // A principal with decision:read before anything else (A-3), then the
  // per-principal model-route limit (A-5).
  const requester = await guardWebRoute(req, 'query')
  if (!requester.ok) return NextResponse.json(requester.body, { status: requester.status, headers: requester.headers })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { question } = (body ?? {}) as { question?: string }
  if (!question || typeof question !== 'string') {
    return NextResponse.json({ error: 'Missing required field: question' }, { status: 400 })
  }

  const traceId = randomUUID()
  const requestSpanId = randomUUID()
  const requestStartedAt = Date.now()
  try {
    const profile = await requireWebAgentProfile(queryQuicksilverAgent.id)
    const memory = webAgentMemoryFor(queryQuicksilverAgent.id)
    const modelStartedAt = Date.now()
    const governed = await executeGovernedAgent(queryQuicksilverAgent, {
      agentId: queryQuicksilverAgent.id,
      taskType: 'reasoning',
      input: question,
      impactLevel: 'low',
      profile,
      memory,
      signal: req.signal,
    })
    const result = governed.output
    const modelSpanId = randomUUID()
    const modelDurationMs = Math.max(0, Date.now() - modelStartedAt)
    const governance = governed.evaluation
    const audit = await persistEvaluations([
      {
        source: 'query',
        agentId: 'nuera-quicksilver:query',
        taskType: 'reasoning',
        modelId: result.modelId,
        subject: question,
        requestedBy: requester.principalId,
        evaluation: governance,
      },
    ])
    const completedAt = Date.now()
    const traceSpans: TraceSpanInput[] = [
      {
        traceId, spanId: requestSpanId, source: 'query', kind: 'request', name: 'query.request',
        status: governance.safetyDecision === 'ALLOW' ? 'ok' : 'blocked', startedAt: requestStartedAt,
        durationMs: completedAt - requestStartedAt, requestedBy: requester.principalId,
        agentId: 'nuera-quicksilver:query',
      },
      {
        traceId, spanId: modelSpanId, parentSpanId: requestSpanId, source: 'query', kind: 'model', name: 'query.model',
        status: 'ok', startedAt: modelStartedAt, durationMs: modelDurationMs, requestedBy: requester.principalId,
        agentId: 'nuera-quicksilver:query', modelId: result.modelId, inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens,
        estimatedCostUsd: estimateModelCostUsd(result.modelId, result.usage.totalTokens),
      },
      ...result.toolCalls.map((toolCall): TraceSpanInput => ({
        traceId, parentSpanId: modelSpanId, source: 'query', kind: 'tool', name: 'query.tool',
        status: toolCall.succeeded ? 'ok' : 'error', startedAt: Math.max(modelStartedAt, completedAt - (toolCall.durationMs ?? 0)),
        durationMs: toolCall.durationMs ?? 0, requestedBy: requester.principalId, agentId: 'nuera-quicksilver:query',
        toolName: toolCall.name, toolSucceeded: toolCall.succeeded,
      })),
      {
        traceId, parentSpanId: requestSpanId, source: 'query', kind: 'evaluation', name: 'nqc.evaluation',
        status: governance.safetyDecision === 'ALLOW' ? 'ok' : 'blocked', startedAt: completedAt, durationMs: 0,
        requestedBy: requester.principalId, agentId: 'nuera-quicksilver:query', modelId: result.modelId,
        safetyDecision: governance.safetyDecision,
      },
    ]
    const telemetry = await persistTraceSpans(traceSpans)
    return NextResponse.json({
      ...result,
      audit: { persisted: audit.persisted, evaluationRecordIds: audit.ids, ...(audit.error ? { error: audit.error } : {}) },
      telemetry: { traceId, persisted: telemetry.persisted },
      nqc: {
        reasoningScore: governance.reasoningScore,
        hallucinationRisk: governance.hallucinationRisk,
        brittleness: governance.brittleness,
        issues: governance.issues,
        corrections: governance.corrections,
        safetyDecision: governance.safetyDecision,
      },
    })
  } catch (err) {
    console.error('[/api/query]', safeErrorName(err))
    const telemetry = await persistTraceSpans([{
      traceId, spanId: requestSpanId, source: 'query', kind: 'request', name: 'query.request', status: 'error',
      startedAt: requestStartedAt, durationMs: Date.now() - requestStartedAt, requestedBy: requester.principalId,
    }])
    return NextResponse.json(
      { error: 'Query failed', detail: safeErrorName(err), telemetry: { traceId, persisted: telemetry.persisted } },
      { status: 500 },
    )
  }
}
