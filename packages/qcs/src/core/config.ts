import { createHash } from 'node:crypto'

import type { ChannelType, QcsAdapter, QcsAuditRecord, QcsAuthority, QcsIntent } from '../interfaces/types.ts'

export interface QcsConfig {
  authority?: QcsAuthority
  audit: (record: QcsAuditRecord) => Promise<void>
  adapters: readonly QcsAdapter[]
  routes: Partial<Record<ChannelType, string>>
}

export function snapshot<T>(value: T): T {
  const active = new Set<object>()
  const validate = (item: unknown, depth: number): void => {
    if (depth > 20) throw new Error('QCS data is too deeply nested.')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (typeof item !== 'object' || active.has(item)) throw new Error('QCS requires finite, acyclic JSON data.')
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw new Error('QCS requires plain JSON objects.')
    active.add(item)
    for (const child of Object.values(item)) validate(child, depth + 1)
    active.delete(item)
  }
  validate(value, 0)
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > 64 * 1024) throw new Error('QCS data exceeds 64 KiB.')
  return JSON.parse(text) as T
}

export function intentFingerprint(intent: QcsIntent): string {
  const canonical = JSON.stringify(snapshot(intent), (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
  })
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

export function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`QCS requires a valid ${label}.`)
}