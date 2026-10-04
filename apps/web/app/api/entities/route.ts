import { NextResponse } from 'next/server'
import { getSanityClient } from '@/lib/sanity-client'
import { guardWebRoute } from '@/lib/route-guard'
import { publicationRefusal } from '@/lib/workflow-publication-http'
import { loadEntityDirectory } from '@/lib/entity-directory'

export const dynamic = 'force-dynamic'

/** Authenticated read-only directory; record edits remain in governed Sanity Studio. */
export async function GET(request: Request) {
  const caller = await guardWebRoute(request, 'entities')
  if (!caller.ok) return publicationRefusal(caller)

  try {
    const directory = await loadEntityDirectory(getSanityClient('read'))
    return NextResponse.json(directory, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[entities] directory load failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: 'Could not load the company directory. Check the configured Quicksilver read data source.', code: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
