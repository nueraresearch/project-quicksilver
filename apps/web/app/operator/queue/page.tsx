'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'

import {
  authFailureMessage,
  consoleHeaders,
  resolveConsoleAccess,
  type ConsoleAccess,
  type ConsoleRoute,
} from '@/lib/console-auth'
import { riskLabel, riskTone } from '@/lib/risk-words'
import { signInPageHref } from '@/lib/session-control'
import styles from './page.module.css'

export interface DecisionQueueItem {
  id: string
  title: string
  status: string
  riskLevel?: number | null
  createdAt?: string | null
  kind?: string | null
}

export interface CommitmentActionItem {
  id: string
  title: string
  counterparty: string
  counterpartyName?: string
  dueDate?: string | null
  dueAt?: string | null
  context?: string | null
  why?: string | null
  notes?: string | null
  description?: string | null
}

export interface WaitingOnOthersItem {
  id: string
  title: string
  counterparty: string
  counterpartyName?: string
  checkBackDate?: string | null
  checkBackAt?: string | null
  daysOverdue?: number
}

export interface UpcomingItem {
  id: string
  title: string
  dueDate?: string | null
  dueAt?: string | null
  counterparty?: string | null
  counterpartyName?: string | null
}

export interface OperatorQueueResponse {
  observedAt?: string
  needsMyDecision?: DecisionQueueItem[]
  needsDecision?: DecisionQueueItem[]
  decisions?: DecisionQueueItem[]
  needsMyAction?: CommitmentActionItem[]
  needsAction?: CommitmentActionItem[]
  iOwe?: CommitmentActionItem[]
  action?: CommitmentActionItem[]
  waitingOnOthers?: WaitingOnOthersItem[]
  theyOwe?: WaitingOnOthersItem[]
  waiting?: WaitingOnOthersItem[]
  upcoming?: UpcomingItem[]
  upcomingItems?: UpcomingItem[]
}

const TONE: Record<string, string> = {
  'awaiting-approval': 'wait',
  proposed: 'wait',
  'rollback-proposed': 'wait',
  approved: 'good',
  executed: 'good',
  'rolled-back': 'good',
  rejected: 'bad',
  failed: 'bad',
}

function ago(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return 'Date not recorded'
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (minutes < 2) return 'just now'
  if (minutes < 90) return `${minutes} min ago`
  if (minutes < 2_160) return `${Math.round(minutes / 60)} h ago`
  return `${Math.round(minutes / 1_440)} days ago`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return 'Date not recorded'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isOverdue(iso: string | null | undefined): boolean {
  if (!iso) return false
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return false
  return time < Date.now()
}

function overdueDaysText(iso: string | null | undefined, explicitDays?: number): string {
  if (explicitDays !== undefined && explicitDays > 0) {
    return `(${explicitDays} ${explicitDays === 1 ? 'day' : 'days'} overdue)`
  }
  if (!iso || Number.isNaN(Date.parse(iso))) return ''
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / (1000 * 60 * 60 * 24)))
  if (days === 0) return '(due today)'
  return `(${days} ${days === 1 ? 'day' : 'days'} overdue)`
}

function truncateContext(text: string | null | undefined): string {
  if (!text) return ''
  const trimmed = text.trim()
  return trimmed.length > 80 ? `${trimmed.slice(0, 80).trim()}…` : trimmed
}

function OperatorQueue() {
  const [access, setAccess] = useState<ConsoleAccess | null>(null)
  const [data, setData] = useState<OperatorQueueResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  useEffect(() => {
    void resolveConsoleAccess(undefined, undefined, { withWhoami: true }).then(setAccess)
  }, [])

  const load = useCallback(async () => {
    if (!access?.signedIn) return
    setLoading(true)
    const path = '/api/operator/queue'
    try {
      const response = await fetch(path, {
        headers: consoleHeaders(path, access.token),
        cache: 'no-store',
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(
          authFailureMessage(response.status, 'operator/queue' as ConsoleRoute, body.error) ??
            body.error ??
            'Could not load operator queue.',
        )
        return
      }
      setData(body as OperatorQueueResponse)
      setCheckedAt(body.observedAt ?? new Date().toISOString())
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

  const needsMyDecision: DecisionQueueItem[] =
    data?.needsMyDecision ?? data?.needsDecision ?? data?.decisions ?? []
  const needsMyAction: CommitmentActionItem[] =
    data?.needsMyAction ?? data?.needsAction ?? data?.iOwe ?? data?.action ?? []
  const waitingOnOthers: WaitingOnOthersItem[] =
    data?.waitingOnOthers ?? data?.theyOwe ?? data?.waiting ?? []
  const upcoming: UpcomingItem[] = data?.upcoming ?? data?.upcomingItems ?? []

  const isAllEmpty =
    !loading &&
    !error &&
    data !== null &&
    needsMyDecision.length === 0 &&
    needsMyAction.length === 0 &&
    waitingOnOthers.length === 0 &&
    upcoming.length === 0

  return (
    <main className="app-main space-y-6">
      <header className="qs-page-heading">
        <p className="qs-eyebrow">Operate</p>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1>My queue</h1>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <Link href="/operator/calendar" className="text-quicksilver-muted hover:text-quicksilver-signal">
              Calendar →
            </Link>
            <Link href="/operator/review" className="text-quicksilver-muted hover:text-quicksilver-signal">
              Reviews →
            </Link>
          </div>
        </div>
        <p className="qs-page-heading__summary">
          What needs your decision, what you owe, what others owe you, and what's coming up.
        </p>
      </header>

      {access && !access.signedIn ? (
        <section className="qs-panel" aria-labelledby="queue-signin">
          <h2 id="queue-signin" className="text-lg font-semibold text-quicksilver-signal">
            Sign in to see your queue
          </h2>
          <p className="qs-helper mt-2">Your queue is private to your organisation.</p>
          <p className="mt-4">
            <Link className="qs-action-primary" href={signInPageHref('/operator/queue')}>
              Sign in
            </Link>
          </p>
        </section>
      ) : (
        <>
          {error && (
            <p className={styles.error} role="alert">
              {error}{' '}
              <button type="button" className={styles.more} onClick={() => void load()}>
                Try again
              </button>
            </p>
          )}

          {isAllEmpty ? (
            <section className="qs-panel" aria-label="Empty queue">
              <p className={styles.empty}>
                Nothing needs your attention right now. Commitments, pending approvals, and
                follow-ups will appear here.
              </p>
            </section>
          ) : (
            <div className={styles.sections}>
              <section className="qs-panel space-y-3" aria-labelledby="section-decisions">
                <div className={styles.sectionHeading}>
                  <h2 id="section-decisions" className="text-base font-semibold text-quicksilver-signal">
                    Needs my decision
                  </h2>
                  <span className={styles.count}>{needsMyDecision.length}</span>
                </div>
                {needsMyDecision.length > 0 ? (
                  <ul className={styles.list}>
                    {needsMyDecision.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={`/decisions?id=${encodeURIComponent(item.id)}`}
                          className={styles.card}
                        >
                          <p className={styles.cardTitle}>{item.title || 'Untitled decision'}</p>
                          <span className={styles.cardMeta}>
                            <span
                              className={styles.status}
                              data-tone={TONE[item.status] ?? 'wait'}
                            >
                              {item.status.replaceAll('-', ' ')}
                            </span>
                            <span className="qs-risk" data-tone={riskTone(item.riskLevel ?? null)}>
                              {item.riskLevel === null && item.kind === 'rollback'
                                ? 'Rollback'
                                : `Risk: ${riskLabel(item.riskLevel ?? null)}`}
                            </span>
                            <span>{ago(item.createdAt)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.sectionEmpty}>No decisions waiting for your approval.</p>
                )}
              </section>

              <section className="qs-panel space-y-3" aria-labelledby="section-action">
                <div className={styles.sectionHeading}>
                  <h2 id="section-action" className="text-base font-semibold text-quicksilver-signal">
                    Needs my action
                  </h2>
                  <span className={styles.count}>{needsMyAction.length}</span>
                </div>
                {needsMyAction.length > 0 ? (
                  <ul className={styles.list}>
                    {needsMyAction.map((item) => {
                      const dueDate = item.dueDate ?? item.dueAt ?? null
                      const counterparty = item.counterparty || item.counterpartyName || 'Unknown counterparty'
                      const contextSnippet = truncateContext(
                        item.context ?? item.why ?? item.notes ?? item.description,
                      )
                      const overdue = isOverdue(dueDate)

                      return (
                        <li key={item.id}>
                          <article className={styles.card}>
                            <p className={styles.cardTitle}>{item.title}</p>
                            <span className={styles.cardMeta}>
                              <span className={styles.counterparty}>{counterparty}</span>
                              {dueDate && (
                                <span className={overdue ? styles.overdue : undefined}>
                                  Due {formatDate(dueDate)}
                                </span>
                              )}
                            </span>
                            {contextSnippet && <p className={styles.context}>{contextSnippet}</p>}
                          </article>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className={styles.sectionEmpty}>No commitments waiting on your action.</p>
                )}
              </section>

              <section className="qs-panel space-y-3" aria-labelledby="section-waiting">
                <div className={styles.sectionHeading}>
                  <h2 id="section-waiting" className="text-base font-semibold text-quicksilver-signal">
                    Waiting on others
                  </h2>
                  <span className={styles.count}>{waitingOnOthers.length}</span>
                </div>
                {waitingOnOthers.length > 0 ? (
                  <ul className={styles.list}>
                    {waitingOnOthers.map((item) => {
                      const checkBackDate = item.checkBackDate ?? item.checkBackAt ?? null
                      const counterparty = item.counterparty || item.counterpartyName || 'Unknown counterparty'

                      return (
                        <li key={item.id}>
                          <article className={styles.card}>
                            <p className={styles.cardTitle}>{item.title}</p>
                            <span className={styles.cardMeta}>
                              <span className={styles.counterparty}>{counterparty}</span>
                              <span>
                                Check-back: {formatDate(checkBackDate)}{' '}
                                <span className={styles.overdue}>
                                  {overdueDaysText(checkBackDate, item.daysOverdue)}
                                </span>
                              </span>
                            </span>
                          </article>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className={styles.sectionEmpty}>No commitments waiting on counterparties.</p>
                )}
              </section>

              <section className="qs-panel space-y-3" aria-labelledby="section-upcoming">
                <div className={styles.sectionHeading}>
                  <h2 id="section-upcoming" className="text-base font-semibold text-quicksilver-signal">
                    Upcoming
                  </h2>
                  <span className={styles.count}>{upcoming.length}</span>
                </div>
                {upcoming.length > 0 ? (
                  <ul className={styles.list}>
                    {upcoming.map((item) => {
                      const dueDate = item.dueDate ?? item.dueAt ?? null
                      const counterparty = item.counterparty || item.counterpartyName

                      return (
                        <li key={item.id}>
                          <article className={styles.card}>
                            <p className={styles.cardTitle}>{item.title}</p>
                            <span className={styles.cardMeta}>
                              {dueDate && <span>Due {formatDate(dueDate)}</span>}
                              {counterparty && (
                                <span className={styles.counterparty}>{counterparty}</span>
                              )}
                            </span>
                          </article>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className={styles.sectionEmpty}>No items due in the next 7 days.</p>
                )}
              </section>
            </div>
          )}

          <p className={styles.fine} role="status">
            {loading ? 'Loading…' : checkedAt ? `Checked ${ago(checkedAt)}.` : ''}
          </p>
        </>
      )}
    </main>
  )
}

export default function QueuePage() {
  return (
    <Suspense
      fallback={
        <main className="app-main">
          <p role="status">Loading queue…</p>
        </main>
      }
    >
      <OperatorQueue />
    </Suspense>
  )
}
