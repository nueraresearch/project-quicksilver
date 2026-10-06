import { join } from 'node:path'

import { MemoryBook, type MemoryEntry, type MemorySensitivity, type MemoryScope } from '@quicksilver/operator'

/** Existing decision routes accept this identifier grammar; provenance must not accept arbitrary paths. */
export const DECISION_ID = /^[A-Za-z0-9._:-]{1,200}$/

export function validDecisionId(value: unknown): value is string {
  return typeof value === 'string' && DECISION_ID.test(value)
}

function segment(value: string): string {
  return `id-${Buffer.from(value, 'utf8').toString('base64url')}`
}

/**
 * Product memory is deliberately opt-in. A serverless process without a durable
 * memory root must fail closed instead of silently promising persistence.
 */
export function productMemoryFor(tenantId: string, principalId: string): MemoryBook {
  const root = process.env.QUICKSILVER_MEMORY_DIR?.trim()
  if (!root) throw new Error('Product memory is not configured; set QUICKSILVER_MEMORY_DIR to a durable, encrypted data root.')
  return new MemoryBook(join(root, segment(tenantId), segment(principalId), 'memory.json'))
}

export function publicMemory(entry: MemoryEntry): Omit<MemoryEntry, 'text'> & { text?: string } {
  return entry.status === 'deleted' ? { ...entry, text: undefined } : entry
}

export function validateMemoryInput(body: unknown): { ok: true; scope: MemoryScope; text: string; retentionDays?: number; sensitivity?: MemorySensitivity; decisionId?: string } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Expected a JSON object.' }
  const input = body as Record<string, unknown>
  if (input.scope !== 'notes' && input.scope !== 'user') return { ok: false, error: 'scope must be notes or user.' }
  if (typeof input.text !== 'string' || input.text.trim().length === 0 || input.text.length > 500) return { ok: false, error: 'text must be 1–500 characters.' }
  if (input.retentionDays !== undefined && (!Number.isInteger(input.retentionDays) || Number(input.retentionDays) < 1 || Number(input.retentionDays) > 3650)) return { ok: false, error: 'retentionDays must be a whole number from 1 to 3,650.' }
  if (input.sensitivity !== undefined && !['standard', 'sensitive', 'restricted'].includes(String(input.sensitivity))) return { ok: false, error: 'sensitivity must be standard, sensitive, or restricted.' }
  if (input.decisionId !== undefined && !validDecisionId(input.decisionId)) return { ok: false, error: 'decisionId is not a valid decision identifier.' }
  return {
    ok: true,
    scope: input.scope,
    text: input.text,
    ...(input.retentionDays === undefined ? {} : { retentionDays: Number(input.retentionDays) }),
    ...(input.sensitivity === undefined ? {} : { sensitivity: input.sensitivity as MemorySensitivity }),
    ...(input.decisionId === undefined ? {} : { decisionId: input.decisionId }),
  }
}
