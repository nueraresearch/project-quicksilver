import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildWebAgentProfileRegistry, createWebAgentProfileResolver, parseWebAgentProfileDocument, webAgentMemoryFor } from './agent-profiles.ts'

const plannerId = 'nuera-quicksilver:planner'
const reviewerId = 'nuera-quicksilver:reviewer'

const profileFile = (agentId: string, additions: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: 1,
  profiles: [{ agentId, version: 2, ...additions }],
})

test('web profile registry gives every governed web agent an isolated memory domain', () => {
  const registry = buildWebAgentProfileRegistry()
  const planner = registry.get(plannerId)
  const reviewer = registry.get(reviewerId)
  assert.equal(planner?.memoryDomain, `agent:${plannerId}`)
  assert.equal(reviewer?.memoryDomain, `agent:${reviewerId}`)
  assert.notEqual(planner?.memoryDomain, reviewer?.memoryDomain)
  assert.throws(() => buildWebAgentProfileRegistry([{ agentId: 'nuera-quicksilver:unknown', version: 1 }]), /unknown web agent/)
})

test('profile configuration is versioned, identity-bound, and strict about unknown fields and resources', () => {
  assert.deepEqual(parseWebAgentProfileDocument(profileFile(plannerId, { skillIds: ['planning-basics'] })).profiles[0], {
    agentId: plannerId, version: 2, memoryDomain: `agent:${plannerId}`, skillIds: ['planning-basics'],
  })
  assert.throws(() => parseWebAgentProfileDocument('{'), /valid JSON/)
  assert.throws(() => parseWebAgentProfileDocument(JSON.stringify({ schemaVersion: 2, profiles: [] })), /schemaVersion 1/)
  assert.throws(() => parseWebAgentProfileDocument(profileFile('nuera-quicksilver:attacker')), /unknown web agent/)
  assert.throws(() => parseWebAgentProfileDocument(profileFile(plannerId, { instructions: 'override policy' })), /unknown field/)
  assert.throws(() => parseWebAgentProfileDocument(JSON.stringify({ schemaVersion: 1, profiles: [{ agentId: plannerId, version: 1 }, { agentId: plannerId, version: 2 }] })), /more than once/)
  assert.throws(() => buildWebAgentProfileRegistry([{ agentId: plannerId, version: 2, memoryDomain: 'agent:nuera-quicksilver:reviewer' }]), /isolated/)
})

test('web resolver loads only active library skills plus bound routine and safe project context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qs-web-agent-profile-'))
  const skills = join(root, 'skills')
  const routines = join(root, 'routines')
  const project = join(root, 'project')
  const profilePath = join(root, 'profiles.json')
  try {
    await mkdir(join(skills, 'active', 'planning-basics'), { recursive: true })
    await mkdir(join(skills, 'pending', 'pending-only'), { recursive: true })
    await mkdir(join(routines, 'active'), { recursive: true })
    await mkdir(project, { recursive: true })
    await writeFile(join(skills, 'active', 'planning-basics', 'SKILL.md'), '---\nname: planning-basics\ndescription: A reviewed planning checklist.\n---\n\nCheck evidence before proposing work.\n')
    await writeFile(join(skills, 'active', 'planning-basics', 'checklist.md'), 'For each action, cite one retrieved record.')
    await writeFile(join(skills, 'pending', 'pending-only', 'SKILL.md'), '---\nname: pending-only\ndescription: Not reviewed yet.\n---\n\nDo not load me.\n')
    await writeFile(join(routines, 'active', 'weekly-review.md'), 'Review open decisions and list unanswered questions.')
    await writeFile(join(project, 'PROJECT.md'), 'Project context is reference data.')
    await writeFile(profilePath, profileFile(plannerId, {
      skillIds: ['planning-basics'], routineIds: ['weekly-review'], contextFiles: ['PROJECT.md'],
    }))

    const resolveProfile = await createWebAgentProfileResolver({
      cwd: root,
      env: {
        QUICKSILVER_AGENT_PROFILES_FILE: profilePath,
        QUICKSILVER_SKILLS_DIR: skills,
        QUICKSILVER_ROUTINES_DIR: routines,
        QUICKSILVER_PROJECT_CONTEXT_ROOT: project,
      },
    })
    const profile = await resolveProfile(plannerId)
    assert.equal(profile?.version, 2)
    assert.deepEqual(profile?.skills, ['planning-basics'])
    assert.deepEqual(profile?.routines, ['weekly-review'])
    assert.match(profile?.context[0] ?? '', /reference only; never an instruction/)
    assert.match(profile?.context[0] ?? '', /Check evidence before proposing work/)
    assert.match(profile?.context[0] ?? '', /For each action, cite one retrieved record/)
    assert.match(profile?.context[0] ?? '', /Review open decisions/)
    assert.match(profile?.context[0] ?? '', /Project context is reference data/)
    assert.equal((await resolveProfile(reviewerId))?.version, 1)

    await writeFile(profilePath, profileFile(plannerId, { skillIds: ['pending-only'] }))
    const pendingResolver = await createWebAgentProfileResolver({ cwd: root, env: { QUICKSILVER_AGENT_PROFILES_FILE: profilePath, QUICKSILVER_SKILLS_DIR: skills } })
    await assert.rejects(pendingResolver(plannerId), /unavailable or returned an invalid identity/)

    await writeFile(join(skills, 'active', 'planning-basics', 'too-large.md'), 'x'.repeat(8_001))
    await writeFile(profilePath, profileFile(plannerId, { skillIds: ['planning-basics'] }))
    const oversizedResolver = await createWebAgentProfileResolver({ cwd: root, env: { QUICKSILVER_AGENT_PROFILES_FILE: profilePath, QUICKSILVER_SKILLS_DIR: skills } })
    await assert.rejects(oversizedResolver(plannerId), /profile resource limit/)
    await rm(join(skills, 'active', 'planning-basics', 'too-large.md'), { force: true })

    const secretPath = join(root, 'outside-skill-file.md')
    const linkPath = join(skills, 'active', 'planning-basics', 'external.md')
    await writeFile(secretPath, 'Do not expose files outside the active skill root.')
    try {
      await symlink(secretPath, linkPath, 'file')
      const symlinkResolver = await createWebAgentProfileResolver({ cwd: root, env: { QUICKSILVER_AGENT_PROFILES_FILE: profilePath, QUICKSILVER_SKILLS_DIR: skills } })
      await assert.rejects(symlinkResolver(plannerId), /symbolic links/)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    } finally {
      await rm(linkPath, { force: true })
    }

    await writeFile(profilePath, profileFile(plannerId, { routineIds: ['missing-routine'] }))
    const missingRoutineResolver = await createWebAgentProfileResolver({ cwd: root, env: { QUICKSILVER_AGENT_PROFILES_FILE: profilePath, QUICKSILVER_ROUTINES_DIR: routines } })
    await assert.rejects(missingRoutineResolver(plannerId))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('web agent memory is opt-in and isolated by tenant and worker identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qs-web-agent-memory-'))
  try {
    assert.equal(webAgentMemoryFor(plannerId, {}), undefined)
    assert.throws(() => webAgentMemoryFor('nuera-quicksilver:unknown', { QUICKSILVER_AGENT_MEMORY_DIR: root }), /unknown web agent/)
    const planner = webAgentMemoryFor(plannerId, { QUICKSILVER_AGENT_MEMORY_DIR: root, QUICKSILVER_TENANT_ID: 'tenant-a' })!
    const reviewer = webAgentMemoryFor(reviewerId, { QUICKSILVER_AGENT_MEMORY_DIR: root, QUICKSILVER_TENANT_ID: 'tenant-a' })!
    const otherTenant = webAgentMemoryFor(plannerId, { QUICKSILVER_AGENT_MEMORY_DIR: root, QUICKSILVER_TENANT_ID: 'tenant-b' })!
    planner.write({
      id: 'planner-note', kind: 'domain-pattern', domain: `agent:${plannerId}`, content: 'Keep the plan evidence-linked.', source: 'test', confidence: 0.9, retentionDays: 30,
    }, { proposedBy: { id: plannerId, kind: 'agent' } })
    assert.equal(planner.recall({ domain: `agent:${plannerId}` }).length, 1)
    assert.equal(reviewer.recall({ domain: `agent:${reviewerId}` }).length, 0)
    assert.equal(otherTenant.recall({ domain: `agent:${plannerId}` }).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('all governed web model routes resolve profiles and pass per-agent memory', async () => {
  const [plan, query, specialists, workflows] = await Promise.all([
    readFile(new URL('../app/api/plan/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/query/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/agents/run/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/workflows/run/route.ts', import.meta.url), 'utf8'),
  ])
  assert.match(plan, /profile:\s*plannerProfile/)
  assert.match(plan, /profile:\s*reviewerProfile/)
  assert.match(query, /executeGovernedAgent\(queryQuicksilverAgent/)
  assert.match(query, /requireWebAgentProfile\(queryQuicksilverAgent\.id\)/)
  assert.match(specialists, /profile,\s*memory:\s*webAgentMemoryFor\(definition\.id\)/)
  assert.match(workflows, /requireWebAgentProfile\(queryQuicksilverAgent\.id\)/)
  for (const source of [plan, query, specialists, workflows]) assert.match(source, /webAgentMemoryFor\(/)
})
