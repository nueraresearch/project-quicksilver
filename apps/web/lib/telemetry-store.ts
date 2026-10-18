import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildTraceSpan, type TraceSpan, type TraceSpanDocument, type TraceSpanInput } from './telemetry.ts'
import { getSanityClient } from './sanity-client.ts'

export interface TraceWriteResult { persisted: boolean; count: number }
type TraceWriter = (documents: TraceSpanDocument[]) => Promise<void>

export async function persistTraceSpanBatch(
  records: TraceSpanInput[],
  writer: TraceWriter,
  tenantId = process.env.QUICKSILVER_TENANT_ID?.trim() || 'default',
): Promise<TraceWriteResult> {
  if (records.length === 0) return { persisted: true, count: 0 }
  if (records.length > 500) return { persisted: false, count: 0 }
  let documents: TraceSpanDocument[]
  try { documents = records.map((record) => buildTraceSpan(record, tenantId)) }
  catch { return { persisted: false, count: 0 } }
  try {
    await writer(documents)
    return { persisted: true, count: documents.length }
  } catch {
    return { persisted: false, count: 0 }
  }
}

export function persistTraceSpans(records: TraceSpanInput[]): Promise<TraceWriteResult> {
  return persistTraceSpanBatch(records, async (documents) => {
    const client = getSanityClient('write')
    const transaction = client.transaction()
    for (const document of documents) transaction.createIfNotExists(document)
    await transaction.commit()
  })
}

const SPAN_FIELDS = '_id,tenantId,traceId,spanId,parentSpanId,source,kind,name,status,startedAt,completedAt,durationMs,requestedBy,runId,workflowId,decisionId,agentId,modelId,toolName,toolSucceeded,inputTokens,outputTokens,totalTokens,estimatedCostUsd,safetyDecision'

/** Convert Sanity datetime strings to epoch milliseconds for alerting and UI consumers. */
export function normalizeTraceSpanDocuments(documents: TraceSpanDocument[]): TraceSpan[] {
  return documents.flatMap(({ _id: _ignored, _type: _alsoIgnored, tenantId: _tenant, completedAt: _completedAt, startedAt, ...span }) => {
    const timestamp = Date.parse(startedAt)
    return Number.isFinite(timestamp) ? [{ ...span, startedAt: timestamp }] : []
  })
}

/** Reads host-side persisted trace spans from a JSONL file, latest first. */
export function readHostLocalTraceSpans(filePath: string, tenantId: string, limit = 200): TraceSpanDocument[] {
  if (!existsSync(filePath)) return []
  try {
    const raw = readFileSync(filePath, 'utf8')
    if (!raw.trim()) return []
    const lines = raw.trim().split('\n')
    const documents: TraceSpanDocument[] = []
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim()
      if (!line) continue
      try {
        const doc = JSON.parse(line) as TraceSpanDocument
        if (doc && doc._type === 'telemetryTraceSpan' && doc.tenantId === tenantId) {
          documents.push(doc)
          if (documents.length >= limit) break
        }
      } catch {
        // Skip corrupted or incomplete lines
      }
    }
    return documents
  } catch {
    return []
  }
}

/** Tenant-scoped query returns bounded metadata only; payloads are never stored in spans. */
export async function listRecentTraceSpans(limit = 200): Promise<TraceSpan[]> {
  const tenantId = process.env.QUICKSILVER_TENANT_ID?.trim() || 'default'
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))

  // 1. Fetch from Sanity store if available
  let sanityDocs: TraceSpanDocument[] = []
  let sanityError: unknown
  try {
    const client = getSanityClient('read')
    sanityDocs = await client.fetch<TraceSpanDocument[]>(
      `*[_type == "telemetryTraceSpan" && tenantId == $tenantId] | order(startedAt desc)[0...$limit]{${SPAN_FIELDS}}`,
      { tenantId, limit: boundedLimit },
    ) ?? []
  } catch (error) {
    sanityError = error
    sanityDocs = []
  }

  // 2. Read host-persisted JSONL trace spans if configured or present
  const configuredSpanPath = process.env.QUICKSILVER_TRACE_SPAN_PATH?.trim() ||
    (process.env.QUICKSILVER_DATA_DIR?.trim() ? join(process.env.QUICKSILVER_DATA_DIR.trim(), 'trace-spans.jsonl') : undefined)
  const hostDocs = configuredSpanPath ? readHostLocalTraceSpans(configuredSpanPath, tenantId, boundedLimit) : []

  // If Sanity failed and there are no host trace spans available, surface the error
  // so health probes and inbox know the store is unavailable rather than empty.
  if (sanityError && hostDocs.length === 0 && !configuredSpanPath) {
    throw sanityError
  }

  // 3. Deduplicate by spanId / _id and sort descending by timestamp
  const seenIds = new Set<string>()
  const merged: TraceSpanDocument[] = []
  for (const doc of [...sanityDocs, ...hostDocs]) {
    const key = doc.spanId || doc._id
    if (key && !seenIds.has(key)) {
      seenIds.add(key)
      merged.push(doc)
    }
  }

  const normalized = normalizeTraceSpanDocuments(merged)
  normalized.sort((a, b) => b.startedAt - a.startedAt)
  return normalized.slice(0, boundedLimit)
}
