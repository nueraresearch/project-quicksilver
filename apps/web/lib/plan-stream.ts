/**
 * The progress stream of POST /api/plan, for a client that sends
 * `Accept: application/x-ndjson`: one JSON object per line, zero or more
 * `step` lines and then exactly one `result` or `error` line. The route writes
 * a step line only when that point in the work is really reached. This module
 * is the shared wire format and the plain words for it, with no I/O.
 */

export const PLAN_NDJSON = 'application/x-ndjson'

export type PlanStepName = 'planner' | 'kernel' | 'reviewer' | 'saved'
export type PlanStepStatus = 'started' | 'done' | 'failed' | 'skipped'

export const PLAN_STEPS: readonly PlanStepName[] = ['planner', 'kernel', 'reviewer', 'saved']
const STATUSES: readonly PlanStepStatus[] = ['started', 'done', 'failed', 'skipped']

export type PlanStreamLine =
  | { type: 'step'; step: PlanStepName; status: PlanStepStatus; at: number; detail?: string }
  | { type: 'result'; body: unknown }
  | { type: 'error'; status: number; error: Record<string, unknown> }

/** "2 of 3": the count carried in a step's `detail` while the kernel or reviewer works through the actions. */
export const countDetail = (done: number, total: number) => `${done} of ${total}`

export function encodePlanLine(line: PlanStreamLine): string {
  return `${JSON.stringify(line)}\n`
}

function parseLine(text: string): PlanStreamLine | null {
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  if (!value || typeof value !== 'object') return null
  const line = value as Record<string, unknown>
  if (line.type === 'step') {
    if (!PLAN_STEPS.includes(line.step as PlanStepName) || !STATUSES.includes(line.status as PlanStepStatus)) return null
    if (typeof line.at !== 'number') return null
    return { type: 'step', step: line.step as PlanStepName, status: line.status as PlanStepStatus, at: line.at, ...(typeof line.detail === 'string' ? { detail: line.detail } : {}) }
  }
  if (line.type === 'result' && 'body' in line) return { type: 'result', body: line.body }
  if (line.type === 'error' && typeof line.status === 'number' && line.error && typeof line.error === 'object') {
    return { type: 'error', status: line.status, error: line.error as Record<string, unknown> }
  }
  // An unknown type, or a line this version cannot read, is skipped: a newer server may add kinds.
  return null
}

/** Feed it text as it arrives, in any chunking; it returns the whole lines completed so far. */
export function createPlanLineDecoder() {
  let pending = ''
  const take = (text: string) => {
    const line = text.trim() ? parseLine(text) : null
    return line ? [line] : []
  }
  return {
    push(chunk: string): PlanStreamLine[] {
      pending += chunk
      const parts = pending.split('\n')
      pending = parts.pop() ?? ''
      return parts.flatMap(take)
    },
    /** The body ended: a last line with no trailing newline still counts. */
    flush(): PlanStreamLine[] {
      const rest = pending
      pending = ''
      return take(rest)
    },
  }
}

export type PlanProgressItem = { step: PlanStepName; status: PlanStepStatus | 'waiting'; label: string }

const COUNT = /^(\d+) of (\d+)$/

/** The sentence for one step in its current state. */
export function planStepLabel(step: PlanStepName, status: PlanStepStatus | 'waiting', detail?: string): string {
  const count = detail ? COUNT.exec(detail) : null
  const counted = count ? (count[1] === count[2] ? `all ${count[2]}` : `${count[1]} of ${count[2]}`) : null
  switch (step) {
    case 'planner':
      if (status === 'waiting') return 'Planner will draft the plan'
      if (status === 'started') return 'Planner is drafting…'
      if (status === 'done') return `Planner drafted ${detail ?? 'the plan'}`
      if (status === 'skipped') return 'Planner did not run'
      return 'Planner could not draft the plan'
    case 'kernel':
      if (status === 'waiting') return 'Kernel will check each action'
      if (status === 'started') return counted ? `Kernel checked ${counted} actions…` : 'Kernel is checking each action…'
      if (status === 'done') return counted ? `Kernel checked ${counted} actions` : 'Kernel checked the actions'
      if (status === 'skipped') return detail ? `Kernel check skipped: ${detail}` : 'Kernel check skipped'
      return 'Kernel check did not finish'
    case 'reviewer':
      if (status === 'waiting') return 'An independent reviewer will read each action'
      if (status === 'started') return counted ? `Reviewer read ${counted} actions…` : 'Reviewer is reading each action…'
      if (status === 'done') return counted ? `Reviewer read ${counted} actions` : 'Reviewer read the actions'
      if (status === 'skipped') return detail ? `Review skipped: ${detail}` : 'Review skipped'
      return 'Review did not finish'
    case 'saved':
      if (status === 'waiting') return 'Decisions will be saved for approval'
      if (status === 'started') return 'Saving decisions…'
      if (status === 'done') return `Saved ${detail ?? 'the decisions'} for approval`
      if (status === 'skipped') return detail ? `Nothing saved: ${detail}` : 'Nothing saved'
      return 'Decisions were not saved'
  }
}

/** The checklist so far: the latest word on each step, in order, with later steps still waiting. */
export function planProgress(lines: readonly PlanStreamLine[]): PlanProgressItem[] {
  const latest = new Map<PlanStepName, { status: PlanStepStatus; detail?: string }>()
  for (const line of lines) if (line.type === 'step') latest.set(line.step, { status: line.status, detail: line.detail })
  return PLAN_STEPS.map((step) => {
    const seen = latest.get(step)
    const status = seen?.status ?? 'waiting'
    return { step, status, label: planStepLabel(step, status, seen?.detail) }
  })
}
