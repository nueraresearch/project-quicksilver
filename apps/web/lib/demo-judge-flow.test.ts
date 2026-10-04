import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const layout = read('../app/layout.tsx')
const banner = read('../components/demo-banner.tsx')
const signIn = read('../app/sign-in/page.tsx')

test('the demo bar appears only when the demo switch is on, and it is the component that switches people', () => {
  assert.match(layout, /\(process\.env\.NEXT_PUBLIC_QUICKSILVER_DEMO_MODE \?\? ''\)\.trim\(\)\.toLowerCase\(\) === 'on' && <DemoBanner \/>/)
  assert.match(banner, /Public demo · synthetic company data only/)
  assert.match(banner, /Switch to \{other\.displayName\}/)
  assert.match(banner, /saveConsoleToken\(other\.token\)/)
  // only the two public demo people can be switched to; the bar never reads a real credential
  assert.match(banner, /DEMO_PRINCIPALS\.find/)
  assert.doesNotMatch(banner, /process\.env\.(?!NEXT_PUBLIC)/)
})

test('the switch button is a full-size tap target and the bar says whose account is in use', () => {
  assert.match(banner, /min-h-11/)
  assert.match(banner, /You are \{me\.displayName\} \(\{me\.purpose\}\)/)
})

test('the demo sign-in is a guided three-step path that starts as the requester and needs no account', () => {
  assert.match(signIn, /Try it as a judge/)
  assert.match(signIn, /No account is needed/)
  assert.match(signIn, /Start as <strong>Marcus Webb<\/strong>/)
  assert.match(signIn, /What I looked at/)
  assert.match(signIn, /Switch to Sarah Chen/)
  assert.match(signIn, /index === 0 \? 'qs-action-primary' : 'qs-action-secondary'/)
  assert.match(signIn, /\{DEMO && !access\?\.signedIn && \(/)
})

test('a demo without organisation sign-in does not show a "not set up" panel to a visitor', () => {
  assert.match(signIn, /DEMO && status !== null && !status\.signInAvailable \? null : \(/)
})
