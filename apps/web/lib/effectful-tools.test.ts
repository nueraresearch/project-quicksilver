import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { CONSOLE_EXECUTION, EFFECTFUL_TOOLS, describeActions } from './effectful-tools.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const toolExecutorPath = join(repoRoot, 'packages', 'host', 'src', 'tool-executor.ts')

/**
 * The console declares the effectful tools itself so it need not depend on the host
 * process. That only stays honest while the two agree, so this reads the host's real
 * manifests and fails on any drift. The same check would otherwise be a comment.
 */
function hostToolManifests(): Array<{ id: string; access: string; requiresApproval: boolean }> {
  const text = readFileSync(toolExecutorPath, 'utf8')
  const manifests: Array<{ id: string; access: string; requiresApproval: boolean }> = []
  for (const match of text.matchAll(/manifest:\s*\{([^}]*)\}/g)) {
    const body = match[1] ?? ''
    const id = /id:\s*'([^']+)'/.exec(body)?.[1]
    const access = /access:\s*'([^']+)'/.exec(body)?.[1]
    const requiresApproval = /requiresApproval:\s*(true|false)/.exec(body)?.[1]
    if (id) manifests.push({ id, access: access ?? 'unknown', requiresApproval: requiresApproval === 'true' })
  }
  return manifests
}

test('every side-effect tool the host defines is disclosed, and nothing else is', () => {
  const hostSideEffects = hostToolManifests().filter((m) => m.access === 'side-effect').map((m) => m.id).sort()
  const disclosed = EFFECTFUL_TOOLS.map((t) => t.id).sort()
  assert.deepEqual(disclosed, hostSideEffects, 'the disclosure must list exactly the host side-effect tools')
})

test('every disclosed tool says it is a dry run here, and how to make it live', () => {
  for (const tool of EFFECTFUL_TOOLS) {
    assert.equal(tool.consoleMode, 'dry-run', tool.id)
    assert.equal(tool.requiresHumanApproval, true, tool.id)
    assert.ok(tool.effect.length > 0, `${tool.id} needs an effect`)
    assert.ok(tool.liveRequires.length > 0, `${tool.id} must say what would make it live`)
  }
})

test('the host marks every side-effect tool as requiring approval', () => {
  for (const manifest of hostToolManifests().filter((m) => m.access === 'side-effect')) {
    assert.equal(manifest.requiresApproval, true, `${manifest.id} must require approval in the host too`)
  }
})

test('the console says execution is simulated and says so without overclaiming', () => {
  const disclosure = describeActions()
  assert.equal(disclosure.execution.consoleMode, 'simulated')
  assert.equal(CONSOLE_EXECUTION.reproducible, true)
  // It must state that nothing leaves the deployment, not merely that it is "simulated".
  assert.match(disclosure.execution.detail, /Nothing leaves this deployment/)
  assert.ok(disclosure.approval.length > 0)
})
