import { test } from 'node:test'
import assert from 'node:assert/strict'

import { productMemoryFor, validDecisionId, validateMemoryInput } from './product-memory.ts'

test('product memory: validates bounded input and decision provenance syntax', () => {
  assert.equal(validDecisionId('decision-abc.1:tenant'), true)
  assert.equal(validDecisionId('../secret'), false)
  assert.equal(validateMemoryInput({ scope: 'notes', text: 'Keep the release checklist current.', decisionId: 'decision-17' }).ok, true)
  assert.equal(validateMemoryInput({ scope: 'notes', text: 'x', decisionId: '../secret' }).ok, false)
  assert.equal(validateMemoryInput({ scope: 'other', text: 'x' }).ok, false)
  assert.equal(validateMemoryInput({ scope: 'notes', text: 'x'.repeat(501) }).ok, false)
})

test('product memory: durable configuration is fail-closed and does not accept an unconfigured root', () => {
  const previous = process.env.QUICKSILVER_MEMORY_DIR
  delete process.env.QUICKSILVER_MEMORY_DIR
  assert.throws(() => productMemoryFor('acme', 'entity-founder'), /QUICKSILVER_MEMORY_DIR/)
  if (previous === undefined) delete process.env.QUICKSILVER_MEMORY_DIR
  else process.env.QUICKSILVER_MEMORY_DIR = previous
})
