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

export type ScheduledItemKind = 'reminder' | 'review-block' | 'meeting' | 'deadline' | 'check-back'
export type ScheduledItemStatus = 'upcoming' | 'done' | 'cancelled'

export interface ScheduledItem {
  id: string
  title: string
  kind: ScheduledItemKind
  startsAt: string
  endsAt?: string | null
  allDay?: boolean
  recurrence?: string | null
  notes?: string | null
  status: ScheduledItemStatus
  createdBy?: string | null
  createdAt?: string | null
}

interface CalendarResponse {
  items: ScheduledItem[]
  count: number
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return 'Unscheduled'
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CalendarContent() {
  const [access, setAccess] = useState<ConsoleAccess | null>(null)
  const [items, setItems] = useState<ScheduledItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('upcoming')
  const [kindFilter, setKindFilter] = useState<string>('all')

  // Form state for creating a scheduled item
  const [newTitle, setNewTitle] = useState('')
  const [newKind, setNewKind] = useState<ScheduledItemKind>('reminder')
  const [newStartsAt, setNewStartsAt] = useState('')
  const [newRecurrence, setNewRecurrence] = useState('')
  const [newNotes, setNewNotes] = useState('')

  useEffect(() => {
    void resolveConsoleAccess(undefined, undefined, { withWhoami: true }).then(setAccess)
  }, [])

  const loadItems = useCallback(async () => {
    if (!access?.signedIn) return
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (kindFilter !== 'all') params.set('kind', kindFilter)

    const path = `/api/operator/calendar?${params.toString()}`
    try {
      const res = await fetch(path, {
        headers: consoleHeaders(path, access.token),
        cache: 'no-store',
      })
      if (res.ok) {
        const body = (await res.json()) as CalendarResponse
        setItems(body.items || [])
      } else {
        setError(`Failed to load calendar items (${res.status}).`)
      }
    } catch {
      setError('Could not reach server to load calendar.')
    } finally {
      setLoading(false)
    }
  }, [access, statusFilter, kindFilter])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!access?.signedIn || !newTitle.trim() || !newStartsAt) return

    setSaving(true)
    setError(null)
    const path = '/api/operator/calendar'
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          ...consoleHeaders(path, access.token),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: newTitle.trim(),
          kind: newKind,
          startsAt: new Date(newStartsAt).toISOString(),
          recurrence: newRecurrence.trim() || undefined,
          notes: newNotes.trim() || undefined,
          status: 'upcoming',
        }),
      })

      if (res.ok) {
        setNewTitle('')
        setNewStartsAt('')
        setNewRecurrence('')
        setNewNotes('')
        await loadItems()
      } else {
        const data = (await res.json()) as { error?: string }
        setError(data.error || 'Failed to create scheduled item.')
      }
    } catch {
      setError('Could not reach server to create item.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="app-main space-y-6">
      <header className="qs-page-heading">
        <p className="qs-eyebrow">Operate</p>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1>In-App Calendar</h1>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <Link href="/operator/queue" className="text-quicksilver-muted hover:text-quicksilver-signal">
              ← Queue
            </Link>
            <Link href="/operator/review" className="text-quicksilver-muted hover:text-quicksilver-signal">
              Reviews →
            </Link>
          </div>
        </div>
        <p className="qs-page-heading__summary">
          Native Quicksilver scheduled items and recurring cron triggers. External calendars are sync targets only.
        </p>
      </header>

      {access && !access.signedIn ? (
        <section className="qs-panel">
          <h2 className="text-lg font-semibold text-quicksilver-signal">Sign in required</h2>
          <p className="text-sm text-quicksilver-muted mt-2">
            Sign in with an authorized principal token to view and manage calendar items.
          </p>
          <div className="mt-4">
            <Link href={signInPageHref('/operator/calendar')} className={styles.button}>
              Sign in
            </Link>
          </div>
        </section>
      ) : (
        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <form onSubmit={handleCreate} className={styles.form}>
              <h2 className="text-sm font-semibold text-quicksilver-signal uppercase tracking-wider">
                Schedule an Item
              </h2>
              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="cal-title">Title</label>
                <input
                  id="cal-title"
                  type="text"
                  required
                  placeholder="e.g. Weekly Operations Sync"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="cal-kind">Kind</label>
                <select
                  id="cal-kind"
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as ScheduledItemKind)}
                  className={styles.select}
                >
                  <option value="reminder">Reminder</option>
                  <option value="review-block">Review Block</option>
                  <option value="meeting">Meeting</option>
                  <option value="deadline">Deadline</option>
                  <option value="check-back">Check-back</option>
                </select>
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="cal-date">Starts At</label>
                <input
                  id="cal-date"
                  type="datetime-local"
                  required
                  value={newStartsAt}
                  onChange={(e) => setNewStartsAt(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="cal-recurrence">Recurrence (Cron)</label>
                <input
                  id="cal-recurrence"
                  type="text"
                  placeholder="@weekly, 0 9 * * 1-5"
                  value={newRecurrence}
                  onChange={(e) => setNewRecurrence(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="cal-notes">Notes</label>
                <textarea
                  id="cal-notes"
                  rows={2}
                  placeholder="Context and details..."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className={styles.textarea}
                />
              </div>

              <button type="submit" disabled={saving || !newTitle.trim() || !newStartsAt} className={styles.button}>
                {saving ? 'Scheduling…' : 'Schedule Item'}
              </button>
            </form>
          </aside>

          <section className="space-y-4">
            <div className={styles.filterBar}>
              <div className="flex items-center gap-2">
                <label className={styles.label} htmlFor="status-filter">Status:</label>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={styles.select}
                >
                  <option value="all">All</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className={styles.label} htmlFor="kind-filter">Kind:</label>
                <select
                  id="kind-filter"
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                  className={styles.select}
                >
                  <option value="all">All Kinds</option>
                  <option value="reminder">Reminder</option>
                  <option value="review-block">Review Block</option>
                  <option value="meeting">Meeting</option>
                  <option value="deadline">Deadline</option>
                  <option value="check-back">Check-back</option>
                </select>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/40 p-3 rounded">
                {error}
              </p>
            )}

            {loading ? (
              <p className="text-sm text-quicksilver-muted">Loading calendar items…</p>
            ) : items.length === 0 ? (
              <div className="qs-panel text-center py-12">
                <p className="text-quicksilver-muted">No scheduled items found matching criteria.</p>
              </div>
            ) : (
              <ul className={styles.itemList}>
                {items.map((item) => (
                  <li key={item.id} className={styles.itemCard}>
                    <div className={styles.itemHeader}>
                      <h3 className={styles.itemTitle}>{item.title}</h3>
                      <span className={styles.badge}>{item.kind}</span>
                    </div>
                    <div className={styles.metaRow}>
                      <span>Starts: {formatDateTime(item.startsAt)}</span>
                      {item.recurrence && <span>Recurrence: {item.recurrence}</span>}
                      <span>Status: {item.status}</span>
                    </div>
                    {item.notes && <p className={styles.notes}>{item.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

export default function OperatorCalendarPage() {
  return (
    <Suspense fallback={<main className="app-main"><p className="text-sm text-quicksilver-muted">Loading calendar…</p></main>}>
      <CalendarContent />
    </Suspense>
  )
}
