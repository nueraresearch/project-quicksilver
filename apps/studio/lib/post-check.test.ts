import assert from 'node:assert/strict'
import test from 'node:test'
import { hasFailure } from './demo-preflight.ts'
import { checkLinkStatus, checkPost, frontMatter, urlsIn } from './post-check.ts'

const token = () => `qs_${'a1B2c3D4'.repeat(4)}`
const good = (extra = '') => `---
title: "A good title"
tags: sanitychallenge, devchallenge, ai, typescript
cover_image: https://example.com/c.png
---
Code: https://github.com/nueraresearch/project-quicksilver. Project f87t11g1. Walkthrough video: https://youtu.be/abc
App https://project-quicksilver.vercel.app token ${token()}
${extra}`

test('a complete post passes', () => assert.equal(hasFailure(checkPost(good())), false))
test('a leftover placeholder fails', () => assert.equal(hasFailure(checkPost(good('[FILL: video link]'))), true))
test('the editing note must be deleted', () => assert.equal(hasFailure(checkPost(good('<!-- BEFORE PUBLISHING -->'))), true))
test('a missing token fails; two different tokens fail', () => {
  assert.equal(hasFailure(checkPost(good().replace(token(), 'TOKEN'))), true)
  assert.equal(hasFailure(checkPost(good(`qs_${'Z9y8X7w6'.repeat(4)}`))), true)
})
test('other secrets fail without being echoed', () => {
  const key = `re_${'x'.repeat(24)}`
  const findings = checkPost(good(key))
  assert.equal(hasFailure(findings), true)
  assert.ok(findings.every((f) => !f.text.includes(key) && !f.text.includes(token())))
})
test('tags: the challenge tag is required and at most four', () => {
  assert.equal(hasFailure(checkPost(good().replace('sanitychallenge, ', ''))), true)
  assert.equal(hasFailure(checkPost(good().replace('typescript', 'typescript, extra'))), true)
})
test('the withdrawn entry must not be linked', () => assert.equal(hasFailure(checkPost(good('https://quicksilver-seven.vercel.app'))), true))
test('helpers', () => {
  assert.equal(frontMatter(good()).title, 'A good title')
  assert.deepEqual(urlsIn('see (https://a.example/x). and https://a.example/x'), ['https://a.example/x'])
  assert.equal(checkLinkStatus('u', 200).length, 0)
  assert.equal(checkLinkStatus('u', 404).length, 1)
  assert.equal(checkLinkStatus('u', 0).length, 1)
})
