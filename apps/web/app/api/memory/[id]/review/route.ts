import { NextResponse } from 'next/server'

import { guardWebRoute } from '@/lib/route-guard'
import { apiErrorBody } from '@/lib/api-errors'
import { productMemoryFor, publicMemory } from '@/lib/product-memory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const caller = await guardWebRoute(request, 'memory/review')
  if (!caller.ok) return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers })
  const { id } = await context.params
  if (!/^mem-[a-f0-9]{10}$/.test(id)) return NextResponse.json(apiErrorBody('That is not a valid memory id.', 400), { status: 400 })
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json(apiErrorBody('Request body must be valid JSON.', 400), { status: 400 }) }
  const approve = body && typeof body === 'object' && typeof (body as { approve?: unknown }).approve === 'boolean' ? (body as { approve: boolean }).approve : undefined
  if (approve === undefined) return NextResponse.json(apiErrorBody('approve must be a boolean.', 400), { status: 400 })
  try {
    const book = productMemoryFor(process.env.QUICKSILVER_TENANT_ID?.trim() || 'default', caller.principalId)
    const entry = await book.review(id, approve, caller.principalId)
    if (!entry && approve) return NextResponse.json(apiErrorBody('Pending memory was not found.', 404), { status: 404 })
    return NextResponse.json({ entry: entry ? publicMemory(entry) : null, approved: approve })
  } catch (error) {
    console.error('[/api/memory/:id/review]', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json(apiErrorBody('Product memory is unavailable.', 503), { status: 503 })
  }
}
