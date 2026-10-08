import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export interface BatchItem<T> { id: string; input: T }

export interface BatchWorkspace {
  id: string
  path: string
  signal: AbortSignal
}

export interface BatchItemResult<O> {
  id: string
  status: 'completed' | 'failed' | 'cancelled' | 'timed-out'
  output?: O
  error?: string
}

export interface BoundedBatchOptions {
  workspaceRoot: string
  maxItems?: number
  maxConcurrency?: number
  timeoutMs?: number
  signal?: AbortSignal
  newWorkspaceId?: (item: BatchItem<unknown>, index: number) => string
}

export interface BoundedBatchResult<O> {
  status: 'completed' | 'partial' | 'failed' | 'cancelled'
  results: BatchItemResult<O>[]
}

const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function positiveBound(value: number | undefined, fallback: number, maximum: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < 1 || result > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}.`)
  return result
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason
  return reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Batch item was cancelled.')
}

/**
 * Run independent items with bounded concurrency and one disposable workspace
 * per item. The executor never shares a mutable directory between items and
 * always attempts cleanup, including timeout and cancellation paths.
 */
export async function executeBoundedBatch<T, O>(
  items: readonly BatchItem<T>[],
  execute: (item: BatchItem<T>, workspace: BatchWorkspace) => Promise<O>,
  options: BoundedBatchOptions,
): Promise<BoundedBatchResult<O>> {
  const maxItems = positiveBound(options.maxItems, 100, 1_000, 'maxItems')
  const maxConcurrency = positiveBound(options.maxConcurrency, 4, 32, 'maxConcurrency')
  const timeoutMs = positiveBound(options.timeoutMs, 300_000, 300_000, 'timeoutMs')
  if (items.length > maxItems) throw new Error(`Batch contains ${items.length} items; the maximum is ${maxItems}.`)
  const ids = new Set<string>()
  for (const item of items) {
    if (!item || !ITEM_ID.test(item.id) || ids.has(item.id)) throw new Error('Batch item ids must be unique stable identifiers.')
    ids.add(item.id)
  }
  await mkdir(options.workspaceRoot, { recursive: true, mode: 0o700 })

  const results = new Array<BatchItemResult<O>>(items.length)
  let next = 0
  let cancelled = false
  const parent = options.signal
  const worker = async (): Promise<void> => {
    while (true) {
      if (parent?.aborted) { cancelled = true; return }
      const index = next++
      if (index >= items.length) return
      const item = items[index]!
      const workspacePath = await mkdtemp(join(options.workspaceRoot, 'subagent-'))
      const workspaceId = options.newWorkspaceId?.(item as BatchItem<unknown>, index) ?? `subagent-${index + 1}`
      const controller = new AbortController()
      const abortFromParent = () => controller.abort(parent?.reason)
      parent?.addEventListener('abort', abortFromParent, { once: true })
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined
      let removeCancellationListener = () => {}
      try {
        if (controller.signal.aborted) throw abortError(controller.signal)
        const work = execute(item, { id: workspaceId, path: workspacePath, signal: controller.signal })
        const timeout = new Promise<never>((_, reject) => {
          deadlineTimer = setTimeout(() => {
            const error = new Error(`Batch item timed out after ${timeoutMs} ms.`)
            reject(error)
            controller.abort(error)
          }, timeoutMs)
        })
        const cancelled = parent ? new Promise<never>((_, reject) => {
          const onCancel = () => reject(abortError(parent))
          if (parent.aborted) onCancel()
          else {
            parent.addEventListener('abort', onCancel, { once: true })
            removeCancellationListener = () => parent.removeEventListener('abort', onCancel)
          }
        }) : null
        const output = await Promise.race(cancelled ? [work, timeout, cancelled] : [work, timeout])
        results[index] = { id: item.id, status: 'completed', output }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Batch item failed.'
        const timedOut = message.includes('timed out')
        const wasCancelled = parent?.aborted || controller.signal.aborted && !timedOut
        results[index] = { id: item.id, status: timedOut ? 'timed-out' : wasCancelled ? 'cancelled' : 'failed', error: message }
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer)
        removeCancellationListener()
        parent?.removeEventListener('abort', abortFromParent)
        try { await rm(workspacePath, { recursive: true, force: true }) } catch (error) {
          if (results[index]?.status === 'completed') results[index] = { id: item.id, status: 'failed', error: `Workspace cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}` }
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, Math.max(items.length, 1)) }, () => worker()))
  const completedResults = items.map((item, index) => results[index] ?? {
    id: item.id,
    status: 'cancelled' as const,
    error: 'Batch item was not started because the batch was cancelled.',
  })
  if (parent?.aborted || cancelled) return { status: 'cancelled', results: completedResults }
  const completed = results.filter((result) => result?.status === 'completed').length
  return { status: completed === items.length ? 'completed' : completed === 0 ? 'failed' : 'partial', results: completedResults }
}
