import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * `npm run verify` type-checks the Studio but does not load `sanity.config.ts`, and
 * `tsc` does not evaluate a module. A plugin that fails to construct, or a schema
 * that is never registered, passes CI and fails `sanity build` instead.
 *
 * The load-time checks read the file as text because they have to hold before the
 * import below can even run. The import is the real one: the entry modules used to
 * use extensionless and directory imports that the Sanity bundler resolved and plain
 * ESM did not, which is what made the config untestable from Node.
 */
const studioDir = new URL('..', import.meta.url)
const read = (rel: string) => readFileSync(new URL(rel, studioDir), 'utf8')

test('the Studio config registers every plugin the entry relies on', () => {
  const config = read('sanity.config.ts')
  // structure: the document tree. workflow: the reviewer kanban. Vision: the GROQ
  // playground a reader uses to see the queries Path One is judged on.
  for (const plugin of ['structureTool', 'workflow', 'visionTool']) {
    assert.match(config, new RegExp(plugin), `${plugin} is missing from sanity.config.ts`)
  }
  // Vision being imported is not the same as Vision being registered.
  assert.match(config, /plugins:\s*\[[^\]]*vision/i, 'visionTool is imported but not in the plugins array')
})

test('the config still goes through the legacy-project guard', () => {
  // d280bqjc is the withdrawn challenge project. Bypassing this call would let a
  // build target it again, and nothing else in the gate would notice.
  assert.match(read('sanity.config.ts'), /dedicatedSanityProjectId\(\)/, 'the config must resolve its project id through the guard')
})

test('every schema file is registered, so a new type cannot be silently ignored', () => {
  // 32 schema types is the failure mode this guards: a file is added, `tsc` is
  // happy, and the document type is simply absent from the Studio.
  const files = readdirSync(new URL('schemas/', studioDir))
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((f) => f.replace(/\.ts$/, ''))
    .sort()
  const registry = read('schemas/index.ts')
  const missing = files.filter((name) => !new RegExp(`\\b${name}\\b`).test(registry))
  assert.deepEqual(missing, [], `schema files not registered in schemas/index.ts: ${missing.join(', ')}`)
})

test('Studio internals use explicit module paths, so the config loads outside the bundler', () => {
  // Was 33 offenders. Extensionless and directory imports are resolvable by the
  // Sanity bundler and by nothing else, so they had to be allowlisted rather than
  // fixed. They are fixed now, and the allowlist is gone: a regression here means
  // the next person cannot test the config at all.
  const offenders: string[] = []
  for (const rel of ['sanity.config.ts', 'schemas/index.ts']) {
    read(rel).split('\n').forEach((line, i) => {
      const match = line.match(/^\s*import\s+.*from\s+'(\.[^']*)'/)
      if (!match) return
      const spec = match[1]!
      if (spec.endsWith('/') || !/\.(ts|tsx|js|json)$/.test(spec)) offenders.push(`${rel}:${i + 1} ${spec}`)
    })
  }
  assert.deepEqual(offenders, [], `unresolvable outside the Studio bundler: ${offenders.join(', ')}`)
})

test('the Studio config actually loads', async () => {
  // The check none of the above can replace. The project id has to be set before the
  // import, not before the assertions: the config calls dedicatedSanityProjectId() at
  // module scope, which is the load-time failure this exists to catch.
  const previous = process.env.SANITY_STUDIO_PROJECT_ID
  process.env.SANITY_STUDIO_PROJECT_ID = 'f87t11g1'
  try {
    const { default: config } = await import('../sanity.config.ts')
    assert.equal(config.name, 'nuera-quicksilver')
    assert.equal(config.projectId, 'f87t11g1')
    assert.ok(config.plugins.length >= 3, 'structure, the decision workflow, and Vision')
    assert.ok(config.schema.types.length > 0, 'the Studio would open with no document types')
    const unnamed = config.schema.types.filter((t) => !t || typeof t.name !== 'string' || !t.name)
    assert.deepEqual(unnamed, [], 'every registered schema type needs a name')
  } finally {
    if (previous === undefined) delete process.env.SANITY_STUDIO_PROJECT_ID
    else process.env.SANITY_STUDIO_PROJECT_ID = previous
  }
})

test('the Studio config refuses the withdrawn challenge project at load time', async () => {
  const previous = process.env.SANITY_STUDIO_PROJECT_ID
  process.env.SANITY_STUDIO_PROJECT_ID = 'd280bqjc'
  try {
    // Cache-busted so the module is evaluated again rather than served from the
    // successful import above.
    await assert.rejects(
      () => import(`../sanity.config.ts?legacy=${process.hrtime.bigint()}`),
      /dedicated Nuera Quicksilver Sanity project/,
    )
  } finally {
    if (previous === undefined) delete process.env.SANITY_STUDIO_PROJECT_ID
    else process.env.SANITY_STUDIO_PROJECT_ID = previous
  }
})
