import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTransientProviderFailure, withMeasuredProviderFallback } from './provider-fallback.ts'
import { appendModelRoutingOutcome, loadModelRoutingProfiles, rollbackModelRoutingHistory, RoutingHistoryIntegrityError } from './routing-history.ts'
import type { ModelPerformanceProfile } from '@quicksilver/kernel'

test('live planner and company-query model calls share measured transient fallback routing', () => {
  const planner = readFileSync(new URL('./planner.ts', import.meta.url), 'utf8')
  const query = readFileSync(new URL('./query.ts', import.meta.url), 'utf8')
  assert.match(planner, /withMeasuredProviderFallback\('planner', \(model, modelId\) => \{[\s\S]*?return generateText\(/)
  assert.match(query, /withMeasuredProviderFallback\('planner', \(model, modelId\) => \{[\s\S]*?return generateText\(/)
  assert.doesNotMatch(planner, /modelForRole\('planner'\)/)
  assert.doesNotMatch(query, /modelForRole\('planner'\)/)
})

test('provider fallback is limited to explicit retryable and transient HTTP failures', () => {
  assert.equal(isTransientProviderFailure({ isRetryable: true }), true)
  assert.equal(isTransientProviderFailure({ statusCode: 429 }), true)
  assert.equal(isTransientProviderFailure({ status: 503 }), true)
  assert.equal(isTransientProviderFailure({ statusCode: 400 }), false)
  assert.equal(isTransientProviderFailure(new Error('bad request')), false)
})

test('measured fallback tries the selected model, then ordered eligible alternatives', async () => {
  const prior = {
    mode: process.env.QUICKSILVER_MODEL_MODE,
    override: process.env.QUICKSILVER_REVIEWER_MODEL,
    config: process.env.QUICKSILVER_ROUTING_CONFIG,
    history: process.env.QUICKSILVER_ROUTING_HISTORY_PATH,
  }
  process.env.QUICKSILVER_MODEL_MODE = 'local'
  delete process.env.QUICKSILVER_REVIEWER_MODEL
  delete process.env.QUICKSILVER_ROUTING_HISTORY_PATH
  process.env.QUICKSILVER_ROUTING_CONFIG = JSON.stringify({ profiles: [
    { modelId: 'first', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.95 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
    { modelId: 'second', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.9 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
    { modelId: 'ineligible', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.4 }, successRate: 1, averageCostPer1kTokens: 0, p95LatencyMs: 1, available: true },
  ] })
  try {
    const attempted: string[] = []
    const selectedIds: string[] = []
    const result = await withMeasuredProviderFallback('reviewer', async (model, selectedModelId) => {
      const id = (model as { modelId?: string }).modelId ?? ''
      attempted.push(id)
      selectedIds.push(selectedModelId)
      if (attempted.length === 1) throw { statusCode: 503 }
      return id
    })
    assert.deepEqual(attempted, ['first', 'second'])
    assert.deepEqual(selectedIds, ['first', 'second'])
    assert.equal(result, 'second')
  } finally {
    if (prior.mode === undefined) delete process.env.QUICKSILVER_MODEL_MODE
    else process.env.QUICKSILVER_MODEL_MODE = prior.mode
    if (prior.override === undefined) delete process.env.QUICKSILVER_REVIEWER_MODEL
    else process.env.QUICKSILVER_REVIEWER_MODEL = prior.override
    if (prior.config === undefined) delete process.env.QUICKSILVER_ROUTING_CONFIG
    else process.env.QUICKSILVER_ROUTING_CONFIG = prior.config
    if (prior.history === undefined) delete process.env.QUICKSILVER_ROUTING_HISTORY_PATH
    else process.env.QUICKSILVER_ROUTING_HISTORY_PATH = prior.history
  }
})

test('routing history is durable, baseline-bound, tamper-evident, and supports human-reviewed rollback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qs-routing-history-'))
  const path = join(dir, 'history.json')
  const baseline: ModelPerformanceProfile[] = [{
    modelId: 'first', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.9 },
    successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true,
  }]
  try {
    assert.deepEqual(await loadModelRoutingProfiles(path, baseline), baseline)
    const now = new Date('2026-10-08T02:00:00.000Z')
    assert.equal(await appendModelRoutingOutcome(path, baseline, {
      modelId: 'first', taskType: 'evaluation', success: false, latencyMs: 300, rateLimited: true,
    }, now), 1)
    const learned = (await loadModelRoutingProfiles(path, baseline))[0]!
    assert.equal(learned.successRate, 0.765)
    assert.equal(learned.p95LatencyMs, 130)
    assert.equal(learned.rateLimitRate, 0.15)

    await assert.rejects(loadModelRoutingProfiles(path, [{ ...baseline[0]!, successRate: 0.8 }]), /different model-profile baseline/)
    await assert.rejects(rollbackModelRoutingHistory(path, baseline, {
      targetSequence: 0, reviewer: { id: 'agent', kind: 'agent' }, reason: 'Attempted non-human rollback.',
    }, now), /named human reviewer/)
    assert.equal(await rollbackModelRoutingHistory(path, baseline, {
      targetSequence: 0, reviewer: { id: 'entity-founder', kind: 'human' }, reason: 'Restore the configured baseline after review.',
    }, now), 2)
    assert.deepEqual(await loadModelRoutingProfiles(path, baseline), baseline)

    const document = JSON.parse(await readFile(path, 'utf8')) as { entries: Array<Record<string, unknown>> }
    document.entries[1]!.reason = 'tampered without recomputing its digest'
    await writeFile(path, JSON.stringify(document))
    await assert.rejects(loadModelRoutingProfiles(path, baseline), RoutingHistoryIntegrityError)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('measured provider dispatch records outcomes and learns reliability for later routes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qs-routing-dispatch-'))
  const historyPath = join(dir, 'history.json')
  const previous = {
    mode: process.env.QUICKSILVER_MODEL_MODE,
    override: process.env.QUICKSILVER_REVIEWER_MODEL,
    config: process.env.QUICKSILVER_ROUTING_CONFIG,
    history: process.env.QUICKSILVER_ROUTING_HISTORY_PATH,
  }
  const profiles: ModelPerformanceProfile[] = [
    { modelId: 'first', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.95 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
    { modelId: 'second', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.9 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
  ]
  process.env.QUICKSILVER_MODEL_MODE = 'local'
  delete process.env.QUICKSILVER_REVIEWER_MODEL
  process.env.QUICKSILVER_ROUTING_CONFIG = JSON.stringify({ profiles })
  process.env.QUICKSILVER_ROUTING_HISTORY_PATH = historyPath
  try {
    const attempted: string[] = []
    const result = await withMeasuredProviderFallback('reviewer', async (model, selectedModelId) => {
      attempted.push(selectedModelId)
      if (attempted.length === 1) throw { statusCode: 429 }
      return (model as { modelId?: string }).modelId
    })
    assert.deepEqual(attempted, ['first', 'second'])
    assert.equal(result, 'second')
    const learned = await loadModelRoutingProfiles(historyPath, profiles)
    assert.equal(learned[0]?.successRate, 0.765)
    assert.equal(learned[0]?.rateLimitRate, 0.15)
    assert.equal(learned[1]?.successRate, 0.915)
    const nextAttempted: string[] = []
    const nextRoute = await withMeasuredProviderFallback('reviewer', async (_model, selectedModelId) => {
      nextAttempted.push(selectedModelId)
      return selectedModelId
    })
    assert.deepEqual(nextAttempted, ['second'], 'the persisted reliability update changes the next route')
    assert.equal(nextRoute, 'second')
  } finally {
    if (previous.mode === undefined) delete process.env.QUICKSILVER_MODEL_MODE
    else process.env.QUICKSILVER_MODEL_MODE = previous.mode
    if (previous.override === undefined) delete process.env.QUICKSILVER_REVIEWER_MODEL
    else process.env.QUICKSILVER_REVIEWER_MODEL = previous.override
    if (previous.config === undefined) delete process.env.QUICKSILVER_ROUTING_CONFIG
    else process.env.QUICKSILVER_ROUTING_CONFIG = previous.config
    if (previous.history === undefined) delete process.env.QUICKSILVER_ROUTING_HISTORY_PATH
    else process.env.QUICKSILVER_ROUTING_HISTORY_PATH = previous.history
    await rm(dir, { recursive: true, force: true })
  }
})

test('non-transient failures do not trigger a measured fallback', async () => {
  const prior = {
    mode: process.env.QUICKSILVER_MODEL_MODE,
    override: process.env.QUICKSILVER_REVIEWER_MODEL,
    config: process.env.QUICKSILVER_ROUTING_CONFIG,
    history: process.env.QUICKSILVER_ROUTING_HISTORY_PATH,
  }
  process.env.QUICKSILVER_MODEL_MODE = 'local'
  delete process.env.QUICKSILVER_REVIEWER_MODEL
  delete process.env.QUICKSILVER_ROUTING_HISTORY_PATH
  process.env.QUICKSILVER_ROUTING_CONFIG = JSON.stringify({ profiles: [
    { modelId: 'first', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.95 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
    { modelId: 'second', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.9 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
  ] })
  try {
    let calls = 0
    await assert.rejects(withMeasuredProviderFallback('reviewer', async () => {
      calls += 1
      throw { statusCode: 400 }
    }))
    assert.equal(calls, 1)
  } finally {
    if (prior.mode === undefined) delete process.env.QUICKSILVER_MODEL_MODE
    else process.env.QUICKSILVER_MODEL_MODE = prior.mode
    if (prior.override === undefined) delete process.env.QUICKSILVER_REVIEWER_MODEL
    else process.env.QUICKSILVER_REVIEWER_MODEL = prior.override
    if (prior.config === undefined) delete process.env.QUICKSILVER_ROUTING_CONFIG
    else process.env.QUICKSILVER_ROUTING_CONFIG = prior.config
    if (prior.history === undefined) delete process.env.QUICKSILVER_ROUTING_HISTORY_PATH
    else process.env.QUICKSILVER_ROUTING_HISTORY_PATH = prior.history
  }
})
test('persistent routing fails closed without its baseline or when history is corrupt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qs-routing-fail-closed-'))
  const historyPath = join(dir, 'history.json')
  const previous = {
    mode: process.env.QUICKSILVER_MODEL_MODE,
    override: process.env.QUICKSILVER_REVIEWER_MODEL,
    config: process.env.QUICKSILVER_ROUTING_CONFIG,
    history: process.env.QUICKSILVER_ROUTING_HISTORY_PATH,
  }
  process.env.QUICKSILVER_MODEL_MODE = 'local'
  delete process.env.QUICKSILVER_REVIEWER_MODEL
  delete process.env.QUICKSILVER_ROUTING_CONFIG
  process.env.QUICKSILVER_ROUTING_HISTORY_PATH = historyPath
  let calls = 0
  try {
    await assert.rejects(withMeasuredProviderFallback('reviewer', async () => {
      calls += 1
      return 'unexpected'
    }), /requires QUICKSILVER_ROUTING_CONFIG/)
    assert.equal(calls, 0)

    process.env.QUICKSILVER_ROUTING_CONFIG = JSON.stringify({ profiles: [
      { modelId: 'first', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.9 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
    ] })
    await writeFile(historyPath, '{')
    await assert.rejects(withMeasuredProviderFallback('reviewer', async () => {
      calls += 1
      return 'unexpected'
    }), /Routing history is not valid JSON/)
    assert.equal(calls, 0)
  } finally {
    if (previous.mode === undefined) delete process.env.QUICKSILVER_MODEL_MODE
    else process.env.QUICKSILVER_MODEL_MODE = previous.mode
    if (previous.override === undefined) delete process.env.QUICKSILVER_REVIEWER_MODEL
    else process.env.QUICKSILVER_REVIEWER_MODEL = previous.override
    if (previous.config === undefined) delete process.env.QUICKSILVER_ROUTING_CONFIG
    else process.env.QUICKSILVER_ROUTING_CONFIG = previous.config
    if (previous.history === undefined) delete process.env.QUICKSILVER_ROUTING_HISTORY_PATH
    else process.env.QUICKSILVER_ROUTING_HISTORY_PATH = previous.history
    await rm(dir, { recursive: true, force: true })
  }
})

test('non-transient failures do not trigger a measured fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qs-routing-nontransient-'))
  const historyPath = join(dir, 'history.json')
  const prior = {
    mode: process.env.QUICKSILVER_MODEL_MODE,
    override: process.env.QUICKSILVER_REVIEWER_MODEL,
    config: process.env.QUICKSILVER_ROUTING_CONFIG,
    history: process.env.QUICKSILVER_ROUTING_HISTORY_PATH,
  }
  process.env.QUICKSILVER_MODEL_MODE = 'local'
  delete process.env.QUICKSILVER_REVIEWER_MODEL
  process.env.QUICKSILVER_ROUTING_HISTORY_PATH = historyPath
  process.env.QUICKSILVER_ROUTING_CONFIG = JSON.stringify({ profiles: [
    { modelId: 'first', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.95 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
    { modelId: 'second', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.9 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
  ] })
  try {
    // A 400 is neither transient nor retryable, so the batch must refuse rather
    // than silently switching models - and the refusal is still recorded.
    let calls = 0
    await assert.rejects(withMeasuredProviderFallback('reviewer', async () => {
      calls += 1
      throw { statusCode: 400 }
    }))
    assert.equal(calls, 1, 'a non-transient failure must not fall through to another model')

    const document = JSON.parse(await readFile(historyPath, 'utf8')) as {
      entries: { kind: string; outcome: { modelId: string; success: boolean; rateLimited?: boolean } }[]
    }
    assert.equal(document.entries.length, 1, 'the refusal is recorded as a durable outcome')
    assert.equal(document.entries[0]?.kind, 'outcome')
    assert.equal(document.entries[0]?.outcome.success, false)
    // A 400 is not a rate limit, so the flag stays unset rather than being
    // recorded as a measured negative.
    assert.ok(document.entries[0]?.outcome.rateLimited !== true, 'a 400 must not be recorded as a rate limit')
  } finally {
    if (prior.mode === undefined) delete process.env.QUICKSILVER_MODEL_MODE
    else process.env.QUICKSILVER_MODEL_MODE = prior.mode
    if (prior.override === undefined) delete process.env.QUICKSILVER_REVIEWER_MODEL
    else process.env.QUICKSILVER_REVIEWER_MODEL = prior.override
    if (prior.config === undefined) delete process.env.QUICKSILVER_ROUTING_CONFIG
    else process.env.QUICKSILVER_ROUTING_CONFIG = prior.config
    if (prior.history === undefined) delete process.env.QUICKSILVER_ROUTING_HISTORY_PATH
    else process.env.QUICKSILVER_ROUTING_HISTORY_PATH = prior.history
    await rm(dir, { recursive: true, force: true })
  }
})

test('a measured success and a rate limit are both recorded and change later routing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qs-routing-measured-'))
  const historyPath = join(dir, 'history.json')
  const prior = {
    mode: process.env.QUICKSILVER_MODEL_MODE,
    override: process.env.QUICKSILVER_REVIEWER_MODEL,
    config: process.env.QUICKSILVER_ROUTING_CONFIG,
    history: process.env.QUICKSILVER_ROUTING_HISTORY_PATH,
  }
  const profiles: ModelPerformanceProfile[] = [
    { modelId: 'first', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.9 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
    { modelId: 'second', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.5 }, successRate: 0.5, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
  ]
  process.env.QUICKSILVER_MODEL_MODE = 'local'
  delete process.env.QUICKSILVER_REVIEWER_MODEL
  process.env.QUICKSILVER_ROUTING_HISTORY_PATH = historyPath
  process.env.QUICKSILVER_ROUTING_CONFIG = JSON.stringify({ profiles })
  try {
    await appendModelRoutingOutcome(historyPath, profiles, { modelId: 'first', taskType: 'evaluation', success: true, latencyMs: 10, rateLimited: false })
    await appendModelRoutingOutcome(historyPath, profiles, { modelId: 'second', taskType: 'evaluation', success: false, latencyMs: 20, rateLimited: true })

    const document = JSON.parse(await readFile(historyPath, 'utf8')) as { entries: { sequence: number; previousDigest: string; digest: string }[] }
    assert.equal(document.entries.length, 2)
    assert.equal(document.entries[0]?.sequence, 1)
    assert.equal(document.entries[1]?.sequence, 2)
    // The chain is linked: entry 2 carries entry 1's digest as its predecessor,
    // so a tampered entry 1 invalidates entry 2 as well.
    assert.equal(document.entries[1]?.previousDigest, document.entries[0]?.digest)

    const replayed = await loadModelRoutingProfiles(historyPath, profiles)
    const first = replayed.find((profile) => profile.modelId === 'first')
    const second = replayed.find((profile) => profile.modelId === 'second')
    assert.ok(first && second, 'both measured profiles survive replay')
    // A recorded success raises the success rate; a recorded failure lowers it.
    assert.ok(first.successRate > profiles[0]!.successRate, 'a success improves the measured success rate')
    assert.ok(second.successRate < profiles[1]!.successRate, 'a failure lowers the measured success rate')

    // A tampered chain is refused rather than silently replayed.
    const tampered = JSON.parse(await readFile(historyPath, 'utf8')) as { entries: { outcome: { success: boolean } }[] }
    tampered.entries[0].outcome.success = false
    await writeFile(historyPath, JSON.stringify(tampered))
    await assert.rejects(loadModelRoutingProfiles(historyPath, profiles), RoutingHistoryIntegrityError)
  } finally {
    if (prior.mode === undefined) delete process.env.QUICKSILVER_MODEL_MODE
    else process.env.QUICKSILVER_MODEL_MODE = prior.mode
    if (prior.override === undefined) delete process.env.QUICKSILVER_REVIEWER_MODEL
    else process.env.QUICKSILVER_REVIEWER_MODEL = prior.override
    if (prior.config === undefined) delete process.env.QUICKSILVER_ROUTING_CONFIG
    else process.env.QUICKSILVER_ROUTING_CONFIG = prior.config
    if (prior.history === undefined) delete process.env.QUICKSILVER_ROUTING_HISTORY_PATH
    else process.env.QUICKSILVER_ROUTING_HISTORY_PATH = prior.history
    await rm(dir, { recursive: true, force: true })
  }
})

test('a routing rollback needs a named human and leaves the audit log intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qs-routing-rollback-'))
  const historyPath = join(dir, 'history.json')
  const profiles: ModelPerformanceProfile[] = [
    { modelId: 'first', supportedTasks: ['evaluation'], taskAccuracy: { evaluation: 0.9 }, successRate: 0.9, averageCostPer1kTokens: 0.1, p95LatencyMs: 100, available: true },
  ]
  try {
    await appendModelRoutingOutcome(historyPath, profiles, { modelId: 'first', taskType: 'evaluation', success: false, latencyMs: 30, rateLimited: false })
    await assert.rejects(rollbackModelRoutingHistory(historyPath, profiles, { targetSequence: 1, reviewer: { id: 'agent-1', kind: 'agent' }, reason: 'looks wrong' }), /named human reviewer/)
    await assert.rejects(rollbackModelRoutingHistory(historyPath, profiles, { targetSequence: 0, reviewer: { id: 'founder', kind: 'human' }, reason: '   ' }), /named human reviewer/)
    // Sequences are 1-based and the target must already exist, so after one
    // entry only sequence 0 is a valid rollback point.
    await assert.rejects(rollbackModelRoutingHistory(historyPath, profiles, { targetSequence: 99, reviewer: { id: 'founder', kind: 'human' }, reason: 'too far ahead' }), /earlier history sequence/)

    await rollbackModelRoutingHistory(historyPath, profiles, { targetSequence: 0, reviewer: { id: 'founder', kind: 'human' }, reason: 'reverted after a bad measurement window' })
    const document = JSON.parse(await readFile(historyPath, 'utf8')) as { entries: { kind: string; reviewedBy?: string; reason?: string }[] }
    assert.equal(document.entries.length, 2, 'a rollback appends; it never rewrites')
    assert.equal(document.entries[1]?.kind, 'rollback')
    assert.equal(document.entries[1]?.reviewedBy, 'founder')
    assert.equal(document.entries[1]?.reason, 'reverted after a bad measurement window')

    // After the rollback the outcome is no longer applied to measured routing,
    // so the profile is identical to the baseline again.
    const replayed = await loadModelRoutingProfiles(historyPath, profiles)
    assert.deepEqual(replayed, profiles, 'a rollback returns measured routing to its baseline')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})