import { NextResponse } from 'next/server'

import { getSanityClient } from '@/lib/sanity-client'
import { guardWebRoute } from '@/lib/route-guard'
import { apiErrorBody } from '@/lib/api-errors'
import { productMemoryFor, publicMemory, validateMemoryInput } from '@/lib/product-memory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function sourceDecisionExists(decisionId: string, tenantId: string): Promise<boolean> {
  const client = getSanityClient('read')
  return Boolean(await client.fetch<boolean>('count(*[_type == "decision" && _id == $id && tenantId == $tenantId]) > 0', { id: decisionId, tenantId }))
}

export async function GET(request: Request): Promise<Response> {
  const caller = await guardWebRoute(request, 'memory/read')
  if (!caller.ok) return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers })
  try {
    const book = productMemoryFor(process.env.QUICKSILVER_TENANT_ID?.trim() || 'default', caller.principalId)
    const entries = (await book.all()).filter((entry) => entry.status !== 'deleted').map(publicMemory)
    return NextResponse.json({ entries, persistence: 'durable-configured' }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[/api/memory GET]', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json(apiErrorBody('Product memory is unavailable.', 503), { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}

export async function POST(request: Request): Promise<Response> {
  const caller = await guardWebRoute(request, 'memory/write')
  if (!caller.ok) return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers })
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json(apiErrorBody('Request body must be valid JSON.', 400), { status: 400 }) }
  const input = validateMemoryInput(body)
  if (!input.ok) return NextResponse.json(apiErrorBody(input.error, 400), { status: 400 })
  try {
    const tenantId = process.env.QUICKSILVER_TENANT_ID?.trim() || 'default'
    if (input.decisionId && !(await sourceDecisionExists(input.decisionId, tenantId))) return NextResponse.json(apiErrorBody('The source decision does not exist in this tenant.', 404), { status: 404 })
    const book = productMemoryFor(tenantId, caller.principalId)
    const entry = await book.addStated(input.scope, input.text, caller.principalId, input.retentionDays, input.sensitivity, input.decisionId ? { decisionId: input.decisionId } : {})
    return NextResponse.json({ entry: publicMemory(entry) }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Product memory is unavailable.'
    const status = /not configured|unavailable/i.test(message) ? 503 : 400
    return NextResponse.json(apiErrorBody(status === 503 ? 'Product memory is unavailable.' : message, status), { status })
  }
}
