import { revokeBrowserSession, signedOutResponse } from '@/lib/oidc-browser-auth'
import { apiErrorBody } from '@/lib/api-errors'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  try {
    const revoked = await revokeBrowserSession(request, process.env)
    if (!revoked) return NextResponse.json(apiErrorBody('Session revocation could not be confirmed.', 503), { status: 503, headers: { 'cache-control': 'no-store' } })
    return signedOutResponse(request)
  } catch (error) {
    console.error('[oidc] logout failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json(apiErrorBody('Session revocation is unavailable.', 503), { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
