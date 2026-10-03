import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HISTORY_LIMIT, canRedo, canUndo, emptyHistory, recordEdit, redo, undo } from './workflow-history.ts'

test('a fresh history has nothing to undo or redo', () => {
  const history = emptyHistory<number>()
  assert.equal(canUndo(history), false)
  assert.equal(canRedo(history), false)
  assert.equal(undo(history, 1), null)
  assert.equal(redo(history, 1), null)
})

test('undo and redo walk back and forward through edits', () => {
  let history = recordEdit(emptyHistory<number>(), 1)
  history = recordEdit(history, 2)
  const back = undo(history, 3)!
  assert.equal(back.snapshot, 2)
  const backAgain = undo(back.history, back.snapshot)!
  assert.equal(backAgain.snapshot, 1)
  assert.equal(canUndo(backAgain.history), false)
  const forward = redo(backAgain.history, backAgain.snapshot)!
  assert.equal(forward.snapshot, 2)
  const last = redo(forward.history, forward.snapshot)!
  assert.equal(last.snapshot, 3)
  assert.equal(canRedo(last.history), false)
})

test('a new edit after an undo clears the redo stack', () => {
  const history = recordEdit(emptyHistory<number>(), 1)
  const back = undo(history, 2)!
  assert.equal(canRedo(back.history), true)
  assert.equal(canRedo(recordEdit(back.history, 1)), false)
})

test('history is bounded and drops the oldest steps', () => {
  let history = emptyHistory<number>()
  for (let value = 0; value < HISTORY_LIMIT + 20; value += 1) history = recordEdit(history, value)
  assert.equal(history.past.length, HISTORY_LIMIT)
  assert.equal(history.past[0], 20)
  let current = 999
  let steps = 0
  for (let step = undo(history, current); step; step = undo(history, current)) {
    current = step.snapshot
    history = step.history
    steps += 1
  }
  assert.equal(steps, HISTORY_LIMIT)
  assert.equal(current, 20)
  assert.equal(history.future.length, HISTORY_LIMIT)
})

test('the redo stack is bounded too', () => {
  const history = { past: [0, 1, 2, 3, 4], future: [0, 1, 2], lastKey: null }
  assert.equal(undo(history, 9, 3)!.history.future.length, 3)
  assert.equal(redo({ ...history, past: [1, 2, 3] }, 9, 3)!.history.past.length, 3)
})

test('consecutive edits with the same key share one undo step', () => {
  let history = recordEdit(emptyHistory<string>(), 'a', 'label:n1')
  history = recordEdit(history, 'ab', 'label:n1')
  history = recordEdit(history, 'abc', 'label:n1')
  assert.deepEqual(history.past, ['a'])
  history = recordEdit(history, 'abcd', 'label:n2')
  assert.deepEqual(history.past, ['a', 'abcd'])
  const back = undo(history, 'abcde')!
  assert.equal(back.snapshot, 'abcd')
  // After an undo, typing in the same field starts a new step.
  const next = recordEdit(back.history, 'abcd', 'label:n2')
  assert.equal(next.past.length, 2)
})

test('unkeyed edits are never coalesced', () => {
  const history = recordEdit(recordEdit(emptyHistory<number>(), 1), 2)
  assert.deepEqual(history.past, [1, 2])
})
