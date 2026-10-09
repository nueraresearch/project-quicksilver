import { createHash } from 'node:crypto'

import { experimentDigest, moneyTotals, verifyMoneyLedger, type Experiment, type MoneyLedger } from '@quicksilver/kernel/playbooks/economics'
import { judgeMetric } from '@quicksilver/kernel/playbooks'
import { contentReviewProblems, type ContentReviewRecord } from './genesis-reviews.ts'

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}
const sha256 = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')

export interface GenesisResearchTrajectory {
  trajectoryId: string
  playbookIdDigest: string
  metricDirection: 'higher-is-better' | 'lower-is-better'
  plannedDurationDays: number
  customerFacing: boolean
  observations: Array<{ day: number; signal: 'kill' | 'hold' | 'continue' | 'scale' }>
  decisions: Array<{ day: number; verdict: string; applied: string; authority: 'human' | 'kernel' | 'other' }>
  contentReviewSignals: Array<{ channel: string; kind: 'manual' | 'waes'; verdict: 'pass' | 'revise' | 'block' }>
  outcome: { status: Experiment['status']; durationDays: number | null; budgetUseRatio: number; revenueToBudgetRatio: number }
}

export interface GenesisResearchDataset {
  schemaVersion: 1
  kind: 'quicksilver.genesis-research-trajectories'
  generatedAt: string
  exportedBy: string
  privacyReview: { declaration: 'structured-only-no-free-text'; noteDigest: string }
  source: { runIdDigest: string; ledgerDigest: string; experimentDigest: string; reviewsDigest: string }
  includedCount: number
  excludedWithoutDecisionCount: number
  trajectories: GenesisResearchTrajectory[]
  digest: string
}

function channelCategory(channel: string): string {
  const known = new Set(['landing-page', 'email', 'ad', 'sms', 'website', 'social-post'])
  return known.has(channel) ? channel : 'other'
}

export function verifyGenesisResearchDataset(value: unknown): value is GenesisResearchDataset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const dataset = value as GenesisResearchDataset
  if (dataset.schemaVersion !== 1 || dataset.kind !== 'quicksilver.genesis-research-trajectories' || !Array.isArray(dataset.trajectories) || typeof dataset.digest !== 'string') return false
  const { digest: supplied, ...core } = dataset
  return supplied === sha256(core)
}

/**
 * Project founder-reviewed Genesis experiments into a low-disclosure,
 * quantitative learning dataset. Free text, raw measurements, transaction
 * details, reviewer identities, secret references, and private reasoning are
 * deliberately never included.
 */
export function exportGenesisResearchTrajectories(input: {
  runId: string
  experiments: Experiment[]
  ledger: MoneyLedger
  reviews: ContentReviewRecord[]
  reviewer: { id: string; kind: 'human' | 'agent' | 'service' }
  privacyNote: string
  now: Date
}): GenesisResearchDataset {
  if (!input.runId.trim()) throw new Error('A Genesis run id is required.')
  if (input.ledger.runId !== input.runId || !verifyMoneyLedger(input.ledger).valid) throw new Error('The Genesis ledger does not verify for this run; research export refused.')
  if (input.reviewer.kind !== 'human' || !input.reviewer.id.trim()) throw new Error('Only a named human can approve a research export.')
  if (!input.privacyNote.trim() || input.privacyNote.length > 500) throw new Error('A privacy review note of 1 to 500 characters is required.')
  if (Number.isNaN(input.now.getTime())) throw new Error('Export time is invalid.')

  for (const experiment of input.experiments) {
    if (experiment.digest !== experimentDigest(experiment.definition)) throw new Error(`Experiment ${experiment.definition.id} failed its definition digest check; research export refused.`)
    if (experiment.measurements.some((measurement) => !Number.isFinite(Date.parse(measurement.at)) || !Number.isFinite(measurement.value))) throw new Error(`Experiment ${experiment.definition.id} has an invalid measurement; research export refused.`)
    if (experiment.decisions.some((decision) => !Number.isFinite(Date.parse(decision.at)))) throw new Error(`Experiment ${experiment.definition.id} has an invalid decision timestamp; research export refused.`)
  }
  for (const review of input.reviews) if (contentReviewProblems(review).length) throw new Error(`Content review ${review.reviewId} is invalid; research export refused.`)

  const totals = moneyTotals(input.ledger)
  const decided = input.experiments.filter((experiment) => experiment.decisions.length > 0)
    .sort((a, b) => a.startedAt?.localeCompare(b.startedAt ?? '') || a.digest.localeCompare(b.digest))
  const trajectories = decided.map((experiment, index): GenesisResearchTrajectory => {
    const started = experiment.startedAt ? Date.parse(experiment.startedAt) : NaN
    const day = (at: string) => Number.isFinite(started) ? Math.max(0, Math.floor((Date.parse(at) - started) / 86_400_000)) : 0
    const perExperiment = totals.byExperiment[experiment.definition.id] ?? { capitalUsedUsd: 0, revenueUsd: 0 }
    const budget = experiment.definition.budgetUsd
    return {
      trajectoryId: `trajectory-${index + 1}`,
      playbookIdDigest: sha256(experiment.definition.playbookId),
      metricDirection: experiment.definition.metric.direction,
      plannedDurationDays: experiment.definition.durationDays,
      customerFacing: experiment.definition.customerFacing,
      observations: [...experiment.measurements].sort((a, b) => a.at.localeCompare(b.at)).map((measurement) => ({ day: day(measurement.at), signal: judgeMetric(experiment.definition.metric, measurement.value) })),
      decisions: [...experiment.decisions].sort((a, b) => a.at.localeCompare(b.at)).map((decision) => ({
        day: day(decision.at),
        verdict: decision.verdict,
        applied: decision.applied,
        authority: decision.by === 'kernel' ? 'kernel' : decision.by === input.reviewer.id ? 'human' : 'other',
      })),
      contentReviewSignals: input.reviews.filter((review) => review.experimentId === experiment.definition.id)
        .map((review) => ({ channel: channelCategory(review.channel), kind: review.kind, verdict: review.verdict })),
      outcome: {
        status: experiment.status,
        durationDays: experiment.startedAt && experiment.endsAt
          ? Math.max(0, Math.floor((Date.parse(experiment.endsAt) - started) / 86_400_000))
          : null,
        budgetUseRatio: budget > 0 ? Math.round((perExperiment.capitalUsedUsd / budget) * 10_000) / 10_000 : 0,
        revenueToBudgetRatio: budget > 0 ? Math.round((perExperiment.revenueUsd / budget) * 10_000) / 10_000 : 0,
      },
    }
  })
  const core = {
    schemaVersion: 1 as const,
    kind: 'quicksilver.genesis-research-trajectories' as const,
    generatedAt: input.now.toISOString(),
    exportedBy: input.reviewer.id,
    privacyReview: { declaration: 'structured-only-no-free-text' as const, noteDigest: sha256(input.privacyNote.trim()) },
    source: {
      runIdDigest: sha256(input.runId),
      ledgerDigest: sha256(input.ledger.entries.map((entry) => entry.hash)),
      experimentDigest: sha256(input.experiments.map((experiment) => experiment.digest).sort()),
      reviewsDigest: sha256(input.reviews.map((review) => ({ contentDigest: review.contentDigest, verdict: review.verdict, kind: review.kind })).sort((a, b) => a.contentDigest.localeCompare(b.contentDigest))),
    },
    includedCount: trajectories.length,
    excludedWithoutDecisionCount: input.experiments.length - trajectories.length,
    trajectories,
  }
  const dataset = { ...core, digest: sha256(core) }
  if (!verifyGenesisResearchDataset(dataset)) throw new Error('The generated research dataset failed its own integrity check.')
  return dataset
}

export interface GenesisResearchPriorImport {
  schemaVersion: 1
  kind: 'quicksilver.genesis-research-prior-import'
  importedAt: string
  sourceDatasetDigest: string
  reviewedBy: string
  review: { declaration: 'owner-reviewed-structured-priors-only'; noteDigest: string }
  trajectories: GenesisResearchTrajectory[]
  digest: string
}

const PRIOR_VERDICTS = new Set(['kill', 'hold', 'continue', 'scale', 'expired', 'over-budget'])
const PRIOR_STATUSES = new Set<Experiment['status']>(['draft', 'running', 'killed', 'held', 'scaled', 'completed'])
const PRIOR_AUTHORITIES = new Set(['human', 'kernel', 'other'])
const PRIOR_CHANNELS = new Set(['landing-page', 'email', 'ad', 'sms', 'website', 'social-post', 'other'])
const PRIOR_REVIEW_KINDS = new Set(['manual', 'waes'])
const PRIOR_REVIEW_VERDICTS = new Set(['pass', 'revise', 'block'])
const SHA256 = /^[a-f0-9]{64}$/

function onlyKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value).every((key) => keys.includes(key))
}

function safePriorTrajectory(value: unknown): value is GenesisResearchTrajectory {
  if (!onlyKeys(value, ['trajectoryId', 'playbookIdDigest', 'metricDirection', 'plannedDurationDays', 'customerFacing', 'observations', 'decisions', 'contentReviewSignals', 'outcome'])) return false
  const t = value
  return typeof t.trajectoryId === 'string' && /^prior-[a-f0-9]{24}$/.test(t.trajectoryId)
    && typeof t.playbookIdDigest === 'string' && SHA256.test(t.playbookIdDigest)
    && (t.metricDirection === 'higher-is-better' || t.metricDirection === 'lower-is-better')
    && Number.isInteger(t.plannedDurationDays) && (t.plannedDurationDays as number) >= 1 && (t.plannedDurationDays as number) <= 90
    && typeof t.customerFacing === 'boolean'
    && Array.isArray(t.observations) && t.observations.length <= 5_000 && t.observations.every((entry) => onlyKeys(entry, ['day', 'signal'])
      && Number.isInteger(entry.day) && (entry.day as number) >= 0 && (entry.day as number) <= 100_000
      && typeof entry.signal === 'string' && ['kill', 'hold', 'continue', 'scale'].includes(entry.signal))
    && Array.isArray(t.decisions) && t.decisions.length <= 5_000 && t.decisions.every((entry) => onlyKeys(entry, ['day', 'verdict', 'applied', 'authority'])
      && Number.isInteger(entry.day) && (entry.day as number) >= 0 && (entry.day as number) <= 100_000
      && typeof entry.verdict === 'string' && PRIOR_VERDICTS.has(entry.verdict)
      && typeof entry.applied === 'string' && PRIOR_STATUSES.has(entry.applied as Experiment['status'])
      && typeof entry.authority === 'string' && PRIOR_AUTHORITIES.has(entry.authority))
    && Array.isArray(t.contentReviewSignals) && t.contentReviewSignals.length <= 5_000 && t.contentReviewSignals.every((entry) => onlyKeys(entry, ['channel', 'kind', 'verdict'])
      && typeof entry.channel === 'string' && PRIOR_CHANNELS.has(entry.channel)
      && typeof entry.kind === 'string' && PRIOR_REVIEW_KINDS.has(entry.kind)
      && typeof entry.verdict === 'string' && PRIOR_REVIEW_VERDICTS.has(entry.verdict))
    && onlyKeys(t.outcome, ['status', 'durationDays', 'budgetUseRatio', 'revenueToBudgetRatio'])
    && typeof t.outcome.status === 'string' && PRIOR_STATUSES.has(t.outcome.status as Experiment['status'])
    && (t.outcome.durationDays === null || Number.isInteger(t.outcome.durationDays) && (t.outcome.durationDays as number) >= 0 && (t.outcome.durationDays as number) <= 100_000)
    && typeof t.outcome.budgetUseRatio === 'number' && Number.isFinite(t.outcome.budgetUseRatio) && t.outcome.budgetUseRatio >= 0 && t.outcome.budgetUseRatio <= 1_000_000
    && typeof t.outcome.revenueToBudgetRatio === 'number' && Number.isFinite(t.outcome.revenueToBudgetRatio) && t.outcome.revenueToBudgetRatio >= 0 && t.outcome.revenueToBudgetRatio <= 1_000_000
}

/** Verify that an imported prior contains only the declared allowlisted fields. */
export function verifyGenesisResearchPriorImport(value: unknown): value is GenesisResearchPriorImport {
  if (!onlyKeys(value, ['schemaVersion', 'kind', 'importedAt', 'sourceDatasetDigest', 'reviewedBy', 'review', 'trajectories', 'digest'])) return false
  const prior = value
  if (prior.schemaVersion !== 1 || prior.kind !== 'quicksilver.genesis-research-prior-import'
    || typeof prior.importedAt !== 'string' || !Number.isFinite(Date.parse(prior.importedAt))
    || typeof prior.sourceDatasetDigest !== 'string' || !SHA256.test(prior.sourceDatasetDigest)
    || typeof prior.reviewedBy !== 'string' || !prior.reviewedBy.trim()
    || !onlyKeys(prior.review, ['declaration', 'noteDigest'])
    || prior.review.declaration !== 'owner-reviewed-structured-priors-only'
    || typeof prior.review.noteDigest !== 'string' || !SHA256.test(prior.review.noteDigest)
    || !Array.isArray(prior.trajectories) || prior.trajectories.length < 1 || prior.trajectories.length > 5_000
    || !prior.trajectories.every(safePriorTrajectory) || typeof prior.digest !== 'string') return false
  const { digest: supplied, ...core } = prior as unknown as GenesisResearchPriorImport
  return supplied === sha256(core)
}

/** Import a dataset only after explicit review; free text and source trajectory IDs are never copied. */
export function createGenesisResearchPriorImport(input: {
  dataset: unknown
  reviewer: { id: string; kind: 'human' | 'agent' | 'service' }
  reviewNote: string
  now: Date
}): GenesisResearchPriorImport {
  if (!verifyGenesisResearchDataset(input.dataset)) throw new Error('Research dataset integrity check failed; prior import refused.')
  const dataset = input.dataset
  if (dataset.privacyReview?.declaration !== 'structured-only-no-free-text' || !SHA256.test(dataset.digest)
    || dataset.includedCount !== dataset.trajectories.length || dataset.trajectories.length < 1 || dataset.trajectories.length > 5_000) {
    throw new Error('Research dataset declaration or trajectory count is invalid; prior import refused.')
  }
  if (input.reviewer.kind !== 'human' || !input.reviewer.id.trim()) throw new Error('Only a named human owner can review Genesis research priors.')
  if (!input.reviewNote.trim() || input.reviewNote.length > 500) throw new Error('A prior-review note of 1 to 500 characters is required.')
  if (!Number.isFinite(input.now.getTime())) throw new Error('Prior-import time is invalid.')

  const trajectories = dataset.trajectories.map((trajectory): GenesisResearchTrajectory => ({
    trajectoryId: `prior-${sha256(`${dataset.digest}:${trajectory.trajectoryId}`).slice(0, 24)}`,
    playbookIdDigest: trajectory.playbookIdDigest,
    metricDirection: trajectory.metricDirection,
    plannedDurationDays: trajectory.plannedDurationDays,
    customerFacing: trajectory.customerFacing,
    observations: trajectory.observations.map(({ day, signal }) => ({ day, signal })),
    decisions: trajectory.decisions.map(({ day, verdict, applied, authority }) => ({ day, verdict, applied, authority })),
    contentReviewSignals: trajectory.contentReviewSignals.map(({ channel, kind, verdict }) => ({ channel, kind, verdict })),
    outcome: { ...trajectory.outcome },
  }))
  if (!trajectories.every(safePriorTrajectory)) throw new Error('Research dataset contains fields outside the safe prior allowlist; import refused.')
  const core = {
    schemaVersion: 1 as const,
    kind: 'quicksilver.genesis-research-prior-import' as const,
    importedAt: input.now.toISOString(),
    sourceDatasetDigest: dataset.digest,
    reviewedBy: input.reviewer.id,
    review: { declaration: 'owner-reviewed-structured-priors-only' as const, noteDigest: sha256(input.reviewNote.trim()) },
    trajectories,
  }
  const prior = { ...core, digest: sha256(core) }
  if (!verifyGenesisResearchPriorImport(prior)) throw new Error('The Genesis prior import failed its own integrity check.')
  return prior
}
