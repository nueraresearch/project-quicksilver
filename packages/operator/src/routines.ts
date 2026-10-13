/**
 * Operator Autonomous Routine Runner (Operator Organization Layer — Phase 5).
 *
 * Runs background operational routines:
 * 1. Morning attention review generator (cadence: daily).
 * 2. Stale loop auditor (resurfacing commitments without activity).
 * 3. Calendar check-back notifier (resurfacing commitments past checkBackAt).
 *
 * Evaluated deterministically with fail-closed governance.
 */

import { assembleReview, type ReviewCadence, type ReviewData } from './review.ts'

export interface RoutineContext {
  decisions?: any[]
  commitments?: any[]
  now?: number
}

export interface RoutineResult {
  kind: 'daily-attention' | 'stale-audit' | 'check-back-sync'
  executedAt: string
  review?: ReviewData
  dueCheckbacksCount?: number
  staleCount?: number
}

/**
 * Runs the daily attention review routine.
 */
export function runDailyAttentionRoutine(ctx: RoutineContext): RoutineResult {
  const now = ctx.now ?? Date.now()
  const review = assembleReview({
    cadence: 'daily',
    decisions: ctx.decisions,
    commitments: ctx.commitments,
    now,
    generatedBy: 'cron:daily-attention',
  })

  return {
    kind: 'daily-attention',
    executedAt: new Date(now).toISOString(),
    review,
  }
}

/**
 * Runs the stale loops audit routine.
 */
export function runStaleLoopAuditRoutine(ctx: RoutineContext): RoutineResult {
  const now = ctx.now ?? Date.now()
  const review = assembleReview({
    cadence: 'stale-loops',
    decisions: ctx.decisions,
    commitments: ctx.commitments,
    now,
    generatedBy: 'cron:stale-loops',
  })

  return {
    kind: 'stale-audit',
    executedAt: new Date(now).toISOString(),
    review,
    staleCount: review.metrics.staleItemsCount,
  }
}

/**
 * Inspects open commitments to identify check-backs that have elapsed and need operator attention.
 */
export function runCheckBackFollowupRoutine(ctx: RoutineContext): RoutineResult {
  const now = ctx.now ?? Date.now()
  const nowIso = new Date(now).toISOString()

  const dueCheckbacks = (ctx.commitments ?? []).filter(
    (c: any) => c.status === 'open' && c.checkBackAt && c.checkBackAt <= nowIso,
  )

  return {
    kind: 'check-back-sync',
    executedAt: nowIso,
    dueCheckbacksCount: dueCheckbacks.length,
  }
}
