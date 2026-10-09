import './globals.css'
import type { Metadata, Viewport } from 'next'
import { AppNavigation } from '@/components/app-navigation'
import { DemoBanner } from '@/components/demo-banner'
import { AgentChatWidget } from '@/components/agent-chat-widget'

// Render per request so each page gets the CSP nonce proxy.ts sets
// (threat model T-67); a prerendered page would carry no nonce and its
// scripts would be blocked.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Nuera Quicksilver — Cognitive + Automation Platform',
  description: 'The NQC Kernel, Quicksilver Engine, governed agents, and enterprise workflows.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-quicksilver-bg text-quicksilver-signal antialiased">
        {(process.env.NEXT_PUBLIC_QUICKSILVER_DEMO_MODE ?? '').trim().toLowerCase() === 'on' && <DemoBanner />}
        <a className="app-skip-link" href="#main-content">Skip to main content</a>
        <AppNavigation />
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
        <AgentChatWidget />
      </body>
    </html>
  )
}
