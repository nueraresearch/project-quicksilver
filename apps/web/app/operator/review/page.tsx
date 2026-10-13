'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  consoleHeaders,
  resolveConsoleAccess,
  type ConsoleAccess,
} from '@/lib/console-auth'
import { signInPageHref } from '@/lib/session-control'
import styles from './page.module.css'

interface ReviewMetrics {
  pendingDecisionsCount: number
  dueCommitmentsCount: number
  waitingOnOthersCount: number
  upcomingCount: number
  staleItemsCount: number
}

interface ReviewItem {
  id?: string
  title: string
  cadence: 'daily' | 'weekly' | 'stale-loops' | 'approvals'
  periodStart: string
  periodEnd: string
  summary: string
  highlights: string[]
  metrics: ReviewMetrics
  generatedAt: string
  generatedBy: string
}

interface ReviewsResponse {
  observedAt: string
  reviews: ReviewItem[]
}

function formatDate(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return 'Date not recorded'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ReviewsContent() {
  const [access, setAccess] = useState<ConsoleAccess | null>(null)
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [selectedReview, setSelectedReview] = useState<ReviewItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'stale-loops'>('daily')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void resolveConsoleAccess(undefined, undefined, { withWhoami: true }).then(setAccess)
  }, [])

  const load = useCallback(async () => {
    if (!access?.signedIn) return
    setLoading(true)
    const path = '/api/operator/reviews'
    try {
      const response = await fetch(path, {
        headers: consoleHeaders(path, access.token),
        cache: 'no-store',
      })
      const body = (await response.json().catch(() => ({}))) as Partial<ReviewsResponse> & {
        error?: string
      }
      if (!response.ok) {
        setError(body.error ?? 'Could not load reviews.')
        return
      }
      const list = body.reviews ?? []
      setReviews(list)
      if (list.length > 0) setSelectedReview(list[0]!)
      setError(null)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [access])

  useEffect(() => {
    void load()
  }, [load])

  const runReview = async () => {
    if (!access?.signedIn || generating) return
    setGenerating(true)
    const path = '/api/operator/reviews'
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: {
          ...consoleHeaders(path, access.token),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ cadence }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        review?: ReviewItem
        error?: string
      }
      if (response.ok && body.review) {
        setReviews((prev) => [body.review!, ...prev])
        setSelectedReview(body.review)
        setError(null)
      } else {
        setError(body.error ?? 'Failed to generate review.')
      }
    } catch {
      setError('Could not trigger review generation.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <main className="app-main space-y-6">
      <header className="qs-page-heading">
        <div className="flex items-center gap-3">
          <Link href="/operator/queue" className="text-sm text-quicksilver-muted hover:text-quicksilver-signal">
            ← My queue
          </Link>
          <span className="text-quicksilver-muted">/</span>
          <Link href="/operator/calendar" className="text-sm text-quicksilver-muted hover:text-quicksilver-signal">
            Calendar
          </Link>
          <span className="text-quicksilver-muted">/</span>
          <p className="qs-eyebrow">Operate</p>
        </div>
        <h1>Operator reviews</h1>
        <p className="qs-page-heading__summary">
          Scheduled and on-demand operational reviews. Daily attention briefs, weekly horizon syntheses, and stale loop audits.
        </p>
      </header>

      {access && !access.signedIn ? (
        <section className="qs-panel" aria-labelledby="review-signin">
          <h2 id="review-signin" className="text-lg font-semibold text-quicksilver-signal">
            Sign in to see reviews
          </h2>
          <p className="qs-helper mt-2">Operational reviews are private to your organisation.</p>
          <p className="mt-4">
            <Link className="qs-action-primary" href={signInPageHref('/operator/review')}>
              Sign in
            </Link>
          </p>
        </section>
      ) : (
        <>
          {error && (
            <p className={styles.error} role="alert">
              {error}{' '}
              <button type="button" className={styles.retry} onClick={() => void load()}>
                Try again
              </button>
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="review-cadence" className="text-sm text-quicksilver-muted">
                Cadence:
              </label>
              <select
                id="review-cadence"
                value={cadence}
                onChange={(e) => setCadence(e.target.value as 'daily' | 'weekly' | 'stale-loops')}
                className={styles.select}
              >
                <option value="daily">Daily attention</option>
                <option value="weekly">Weekly synthesis</option>
                <option value="stale-loops">Stale loops</option>
              </select>
              <button
                type="button"
                className="qs-action-primary"
                onClick={() => void runReview()}
                disabled={generating}
              >
                {generating ? 'Generating review…' : 'Run review now'}
              </button>
            </div>
            <p className="text-xs text-quicksilver-muted">
              {reviews.length} snapshot{reviews.length === 1 ? '' : 's'} available
            </p>
          </div>

          <div className={styles.layout}>
            <section className={styles.sidebar} aria-label="Review history">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-quicksilver-muted mb-2">
                Snapshots
              </h2>
              {loading ? (
                <p className={styles.fine}>Loading reviews…</p>
              ) : reviews.length === 0 ? (
                <p className={styles.fine}>No reviews recorded yet.</p>
              ) : (
                <ul className={styles.list}>
                  {reviews.map((r, i) => {
                    const isSelected = selectedReview?.id === r.id || (!selectedReview && i === 0)
                    return (
                      <li key={r.id ?? `review-${i}`}>
                        <button
                          type="button"
                          className={styles.reviewItem}
                          aria-current={isSelected ? 'true' : undefined}
                          onClick={() => setSelectedReview(r)}
                        >
                          <p className={styles.reviewTitle}>{r.title}</p>
                          <span className={styles.reviewMeta}>
                            <span className={styles.badge}>{r.cadence}</span>
                            <span>{formatDate(r.generatedAt)}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className={styles.content} aria-label="Review details">
              {selectedReview ? (
                <article className="qs-panel space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-quicksilver-border/50 pb-3">
                    <div>
                      <h2 className="text-xl font-bold text-quicksilver-signal">{selectedReview.title}</h2>
                      <p className="text-xs text-quicksilver-muted mt-1">
                        Generated {formatDate(selectedReview.generatedAt)} by {selectedReview.generatedBy}
                      </p>
                    </div>
                    <span className={styles.badge}>{selectedReview.cadence}</span>
                  </div>

                  <div className={styles.metricsGrid}>
                    <div className={styles.metricCard}>
                      <span className={styles.metricValue}>
                        {selectedReview.metrics.pendingDecisionsCount}
                      </span>
                      <span className={styles.metricLabel}>Pending approvals</span>
                    </div>
                    <div className={styles.metricCard}>
                      <span className={styles.metricValue}>
                        {selectedReview.metrics.dueCommitmentsCount}
                      </span>
                      <span className={styles.metricLabel}>Actions due</span>
                    </div>
                    <div className={styles.metricCard}>
                      <span className={styles.metricValue}>
                        {selectedReview.metrics.waitingOnOthersCount}
                      </span>
                      <span className={styles.metricLabel}>Waiting on others</span>
                    </div>
                    <div className={styles.metricCard}>
                      <span className={styles.metricValue}>
                        {selectedReview.metrics.staleItemsCount}
                      </span>
                      <span className={styles.metricLabel}>Stale loops (&gt;14d)</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-quicksilver-signal">Highlights</h3>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-quicksilver-signal">
                      {selectedReview.highlights.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-quicksilver-signal">Operational Summary</h3>
                    <div className={styles.summaryBox}>
                      <p className="whitespace-pre-line text-sm text-quicksilver-signal/90 font-mono">
                        {selectedReview.summary}
                      </p>
                    </div>
                  </div>
                </article>
              ) : (
                <div className="qs-panel p-8 text-center text-quicksilver-muted">
                  Choose a review snapshot or click &quot;Run review now&quot; to generate a fresh brief.
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  )
}

export default function OperatorReviewPage() {
  return (
    <Suspense
      fallback={
        <main className="app-main">
          <p role="status">Loading reviews…</p>
        </main>
      }
    >
      <ReviewsContent />
    </Suspense>
  )
}
