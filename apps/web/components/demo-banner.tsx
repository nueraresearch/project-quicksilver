'use client'

import { useEffect, useState } from 'react'

import { resolveConsoleAccess, saveConsoleToken } from '@/lib/console-auth'
import { DEMO_PRINCIPALS, type DemoPrincipal } from '@/lib/demo-mode'

/**
 * The strip across the top of a public demo. It says whose account you are using and switches to the other
 * person in one press, because the demo shows separation of duties: Marcus plans, Sarah approves, and neither
 * can do the other's part. Shown only when the demo switch is on (the layout decides).
 */
export function DemoBanner() {
  const [me, setMe] = useState<DemoPrincipal | null | undefined>(undefined)

  useEffect(() => {
    void resolveConsoleAccess(undefined, undefined, { withWhoami: true }).then((access) => {
      const id = access.whoami?.principalId
      setMe(DEMO_PRINCIPALS.find((person) => person.id === id) ?? null)
    })
  }, [])

  const other = me ? DEMO_PRINCIPALS.find((person) => person.id !== me.id) : undefined

  return (
    <div role="note" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-quicksilver-border bg-quicksilver-panel px-4 py-2 text-center font-mono text-[11px] uppercase tracking-widest text-quicksilver-accent">
      <span>Public demo · synthetic company data only · resets regularly</span>
      {me && other && (
        <span className="flex flex-wrap items-center justify-center gap-2 normal-case tracking-normal">
          <span>You are {me.displayName} ({me.purpose}).</span>
          <button
            type="button"
            className="min-h-11 rounded border border-quicksilver-border px-3 text-quicksilver-signal underline"
            onClick={() => { if (saveConsoleToken(other.token)) window.location.reload() }}
          >
            Switch to {other.displayName} ({other.purpose})
          </button>
        </span>
      )}
    </div>
  )
}
