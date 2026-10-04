'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { DEMO_PRINCIPALS } from '@/lib/demo-mode'
import { clearConsoleToken, resolveConsoleAccess, saveConsoleToken, type ConsoleAccess } from '@/lib/console-auth'
import { returnToFrom, signInHref } from '@/lib/session-control'

const DEMO = process.env.NEXT_PUBLIC_QUICKSILVER_DEMO_MODE === 'on'

type Status = { signInAvailable: boolean }

export default function SignInPage() {
  const [returnTo, setReturnTo] = useState('/')
  const [failed, setFailed] = useState(false)
  const [access, setAccess] = useState<ConsoleAccess | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [draft, setDraft] = useState('')
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setReturnTo(returnToFrom(window.location.search))
    setFailed(new URLSearchParams(window.location.search).get('auth') === 'failed')
    void resolveConsoleAccess().then(setAccess)
    void fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => response.json())
      .then((body: { signInAvailable?: boolean }) => setStatus({ signInAvailable: body.signInAvailable === true }))
      .catch(() => setStatus({ signInAvailable: false }))
  }, [])

  async function useToken(token: string) {
    const trimmed = token.trim()
    if (!trimmed) return
    setBusy(true)
    setTokenError(null)
    try {
      saveConsoleToken(trimmed)
      const response = await fetch('/api/whoami', { headers: { authorization: `Bearer ${trimmed}` }, cache: 'no-store' })
      if (response.status === 200) { window.location.assign(returnTo); return }
      clearConsoleToken()
      setTokenError(response.status === 401 ? 'That token was not accepted. Check it and try again.' : 'The server could not check that token. Try again in a moment.')
    } catch {
      clearConsoleToken()
      setTokenError('The server could not be reached. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const name = access?.whoami?.displayName ?? access?.whoami?.principalId

  return (
    <main className="app-main space-y-6">
      <header>
        <p className="qs-eyebrow">Nuera Quicksilver</p>
        <h1 className="qs-page-heading">Sign in</h1>
        <p className="qs-page-heading__summary">Sign in to see your decisions, approve work and use the chat.</p>
      </header>

      {failed && (
        <section className="qs-panel space-y-3" role="alert" aria-labelledby="signin-failed">
          <h2 id="signin-failed" className="text-lg font-semibold">Sign-in did not finish</h2>
          <p>Nothing was changed. If this keeps happening, your account may not be on the access list yet: ask an administrator to add it, then try again.</p>
        </section>
      )}

      {access?.signedIn ? (
        <section className="qs-panel space-y-3" aria-labelledby="signin-done">
          <h2 id="signin-done" className="text-lg font-semibold">{name ? `You are signed in as ${name}` : 'You are signed in'}</h2>
          <p>{access.token ? 'You are using an access token in this tab.' : 'You are signed in with your organisation account.'}</p>
          <p><Link className="qs-action-primary" href={returnTo}>Continue</Link></p>
        </section>
      ) : DEMO && status !== null && !status.signInAvailable ? null : (
        <section className="qs-panel space-y-3" aria-labelledby="signin-org">
          <h2 id="signin-org" className="text-lg font-semibold">Your organisation account</h2>
          {status === null ? <p role="status">Checking how sign-in works here…</p> : status.signInAvailable ? (
            <>
              <p>You will be sent to your organisation to sign in, then brought back here.</p>
              <p><a className="qs-action-primary" href={signInHref(returnTo)}>Continue with your organisation account</a></p>
            </>
          ) : (
            <p>Organisation sign-in is not set up for this site. If you were given an access token, use it below.</p>
          )}
        </section>
      )}

      {DEMO && !access?.signedIn && (
        <section className="qs-panel space-y-3" aria-labelledby="signin-demo">
          <h2 id="signin-demo" className="text-lg font-semibold">Try it as a judge</h2>
          <p>This is a public demo with synthetic company data. No account is needed: pick an account below. The demo shows agents proposing and humans authorizing, and the one who asks and the one who approves must be different, so it uses two accounts.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Start as <strong>Marcus Webb</strong>. Ask the chat to plan something, or ask it what the company&rsquo;s policies say, then open <strong>What I looked at</strong> under its answer.</li>
            <li>Press <strong>Create plan</strong> on the card it offers. The planner agent drafts it and it is saved as a decision that needs approval, recording Marcus as the requester and the planner as the proposer.</li>
            <li>Use <strong>Switch to Sarah Chen</strong> in the bar at the top. She is a different account from the requester and the proposer, so she can approve it. Marcus and the planner cannot.</li>
          </ol>
          <p className="flex flex-wrap gap-2">
            {DEMO_PRINCIPALS.map((person, index) => (
              <button key={person.id} type="button" className={index === 0 ? 'qs-action-primary' : 'qs-action-secondary'} onClick={() => void useToken(person.token)} disabled={busy}>
                {index === 0 ? 'Start as ' : ''}{person.displayName}, {person.title} ({person.purpose})
              </button>
            ))}
          </p>
        </section>
      )}

      {!access?.signedIn && (
        <details className="qs-panel space-y-3">
          <summary className="min-h-11 cursor-pointer py-2">Use an access token instead</summary>
          <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void useToken(draft) }}>
            <label htmlFor="signin-token">Access token</label>
            <input id="signin-token" className="qs-field qs-field--token" type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
            <p className="text-sm">The token stays in this browser tab only and is sent only to this site. It is cleared when you close the tab.</p>
            {tokenError && <p role="alert">{tokenError}</p>}
            <button type="submit" className="qs-action-secondary" disabled={busy || draft.trim().length === 0}>Use this token</button>
          </form>
        </details>
      )}
    </main>
  )
}
