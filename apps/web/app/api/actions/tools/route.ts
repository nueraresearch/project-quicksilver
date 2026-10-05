/**
 * GET /api/actions/tools — what this deployment can actually do.
 *
 * The console records decisions; it does not send anything to the outside world. This
 * route says so, in the deployment's own voice, with the exact configuration that would
 * change it. An asynchronous reader evaluating the project will press Approve and Execute
 * on their own, and should not have to take a README's word for what those buttons do.
 *
 * Read-only, requires the same permission as the decision list, and never reads a
 * credential or contacts the host.
 */
import { NextResponse } from 'next/server'
import { guardWebRoute } from '@/lib/route-guard'
import { describeActions } from '@/lib/effectful-tools'
import { publicationRefusal } from '@/lib/workflow-publication-http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const caller = await guardWebRoute(request, 'actions/tools')
  if (!caller.ok) return publicationRefusal(caller)

  const disclosure = describeActions()
  return NextResponse.json(disclosure, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
