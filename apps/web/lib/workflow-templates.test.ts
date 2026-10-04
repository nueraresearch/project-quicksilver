import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateWorkflowGraph } from '../../../packages/kernel/src/workflows/graph.ts'
import { WORKFLOW_TEMPLATES, templateGraph } from './workflow-templates.ts'

test('there are three to four starter templates with unique ids', () => {
  assert.ok(WORKFLOW_TEMPLATES.length >= 3 && WORKFLOW_TEMPLATES.length <= 4)
  assert.equal(new Set(WORKFLOW_TEMPLATES.map((template) => template.id)).size, WORKFLOW_TEMPLATES.length)
})

for (const template of WORKFLOW_TEMPLATES) {
  test(`template "${template.title}" passes workflow validation`, () => {
    const result = validateWorkflowGraph(template.graph)
    assert.deepEqual(result.errors, [])
    assert.equal(result.valid, true)
    assert.equal(template.graph.id, template.id)
    assert.ok(template.title && template.summary && template.outline)
  })

  test(`template "${template.title}" is read-only and keeps ids the editor can continue from`, () => {
    for (const node of template.graph.nodes) {
      assert.notEqual(node.kind, 'tool')
      assert.notEqual(node.config?.sideEffect, true)
      assert.match(node.id, /^[a-z]+-\d+$/)
    }
    for (const edge of template.graph.edges) assert.match(edge.id, /^edge-\d+$/)
  })
}

test('templateGraph returns an independent copy and null for unknown ids', () => {
  const first = templateGraph('weekly-summary-review')!
  first.nodes[0]!.label = 'Changed'
  assert.notEqual(templateGraph('weekly-summary-review')!.nodes[0]!.label, 'Changed')
  assert.notEqual(WORKFLOW_TEMPLATES[0]!.graph.nodes[0]!.label, 'Changed')
  assert.equal(templateGraph('missing'), null)
})
