import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countDetail, createPlanLineDecoder, encodePlanLine, planProgress, planStepLabel, type PlanStreamLine } from './plan-stream.ts'

const lines: PlanStreamLine[] = [
  { type: 'step', step: 'planner', status: 'started', at: 1 },
  { type: 'step', step: 'planner', status: 'done', at: 2, detail: '3 actions' },
  { type: 'result', body: { decisions: [] } },
]

test('lines survive an encode and decode round trip, one per line', () => {
  const text = lines.map(encodePlanLine).join('')
  assert.equal(text.split('\n').length, lines.length + 1)
  const decoder = createPlanLineDecoder()
  assert.deepEqual(decoder.push(text), lines)
  assert.deepEqual(decoder.flush(), [])
})

test('a chunk that ends mid-line waits for the rest, at any split point', () => {
  const text = lines.map(encodePlanLine).join('')
  for (let cut = 1; cut < text.length; cut += 7) {
    const decoder = createPlanLineDecoder()
    const got = [...decoder.push(text.slice(0, cut)), ...decoder.push(text.slice(cut)), ...decoder.flush()]
    assert.deepEqual(got, lines)
  }
})

test('a final line without a newline is returned when the body ends', () => {
  const decoder = createPlanLineDecoder()
  assert.deepEqual(decoder.push(JSON.stringify(lines[2])), [])
  assert.deepEqual(decoder.flush(), [lines[2]])
})

test('an error line keeps its status and body', () => {
  const line: PlanStreamLine = { type: 'error', status: 500, error: { error: 'Plan failed', detail: 'Error' } }
  assert.deepEqual(createPlanLineDecoder().push(encodePlanLine(line)), [line])
})

test('unknown line types, unknown steps, malformed lines and blank lines are ignored', () => {
  const decoder = createPlanLineDecoder()
  const text = [
    '{"type":"heartbeat"}', '{"type":"step","step":"mystery","status":"done","at":1}', '{"type":"step","step":"kernel","status":"done"}',
    '{not json', '', '42', 'null', '{"type":"error","status":"x","error":{}}', encodePlanLine(lines[0]!).trim(),
  ].join('\n') + '\n'
  assert.deepEqual(decoder.push(text), [lines[0]])
})

test('the checklist shows the latest word on each step and the rest as waiting', () => {
  const progress = planProgress([
    { type: 'step', step: 'planner', status: 'done', at: 1, detail: '3 actions' },
    { type: 'step', step: 'kernel', status: 'started', at: 2, detail: countDetail(0, 3) },
    { type: 'step', step: 'kernel', status: 'started', at: 3, detail: countDetail(2, 3) },
  ])
  assert.deepEqual(progress.map((item) => item.status), ['done', 'started', 'waiting', 'waiting'])
  assert.equal(progress[0]!.label, 'Planner drafted 3 actions')
  assert.equal(progress[1]!.label, 'Kernel checked 2 of 3 actions…')
})

test('step wording is plain and says when a step did not run or did not finish', () => {
  assert.equal(planStepLabel('planner', 'started'), 'Planner is drafting…')
  assert.equal(planStepLabel('kernel', 'done', '3 of 3'), 'Kernel checked all 3 actions')
  assert.equal(planStepLabel('reviewer', 'done', '2 of 3'), 'Reviewer read 2 of 3 actions')
  assert.equal(planStepLabel('reviewer', 'skipped', 'The planner proposed no actions'), 'Review skipped: The planner proposed no actions')
  assert.equal(planStepLabel('saved', 'done', '2 decisions'), 'Saved 2 decisions for approval')
  assert.equal(planStepLabel('saved', 'failed'), 'Decisions were not saved')
})
