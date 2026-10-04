/**
 * Bounded undo/redo for the workflow editor. Pure: the page keeps the current
 * snapshot in its own state and hands it in, so these helpers never hold state.
 */
export const HISTORY_LIMIT = 50

export interface EditHistory<T> {
  past: T[]
  future: T[]
  /** Key of the last coalesced edit (such as typing in one field), cleared by undo and redo. */
  lastKey: string | null
}

export function emptyHistory<T>(): EditHistory<T> {
  return { past: [], future: [], lastKey: null }
}

export function canUndo<T>(history: EditHistory<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: EditHistory<T>): boolean {
  return history.future.length > 0
}

/**
 * Record `current` (the state before an edit) so the edit can be undone. A new
 * edit clears the redo stack. Repeated edits with the same `coalesceKey` in a
 * row, such as keystrokes in one field, share a single undo step.
 */
export function recordEdit<T>(history: EditHistory<T>, current: T, coalesceKey: string | null = null, limit = HISTORY_LIMIT): EditHistory<T> {
  if (coalesceKey !== null && coalesceKey === history.lastKey && history.past.length > 0) {
    return history.future.length === 0 ? history : { ...history, future: [] }
  }
  return { past: [...history.past, current].slice(-limit), future: [], lastKey: coalesceKey }
}

/** Step back. Returns null when there is nothing to undo. */
export function undo<T>(history: EditHistory<T>, current: T, limit = HISTORY_LIMIT): { history: EditHistory<T>; snapshot: T } | null {
  if (history.past.length === 0) return null
  const snapshot = history.past[history.past.length - 1]!
  return { snapshot, history: { past: history.past.slice(0, -1), future: [...history.future, current].slice(-limit), lastKey: null } }
}

/** Step forward again. Returns null when there is nothing to redo. */
export function redo<T>(history: EditHistory<T>, current: T, limit = HISTORY_LIMIT): { history: EditHistory<T>; snapshot: T } | null {
  if (history.future.length === 0) return null
  const snapshot = history.future[history.future.length - 1]!
  return { snapshot, history: { past: [...history.past, current].slice(-limit), future: history.future.slice(0, -1), lastKey: null } }
}

export const NOTHING_TO_UNDO = 'Nothing to undo yet. Change the workflow first.'
export const NOTHING_TO_REDO = 'Nothing to redo. Redo is available after you undo a change.'
