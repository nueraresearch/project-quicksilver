import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

import {
  AgentProfileRegistry,
  BUSINESS_AGENT_DEFINITIONS,
  MAX_AGENT_PROFILE_RESOURCE_CHARS,
  plannerQuicksilverAgent,
  queryQuicksilverAgent,
  readProjectContextFile,
  reviewerQuicksilverAgent,
  type AgentProfileDefinition,
  type ResolvedAgentProfile,
} from '@quicksilver/agent'
import { SkillLibrary } from '@quicksilver/operator'
import { FileMemoryStore, type MemoryStore } from '@quicksilver/kernel'

const WEB_AGENT_IDS: ReadonlySet<string> = new Set<string>([
  plannerQuicksilverAgent.id,
  reviewerQuicksilverAgent.id,
  queryQuicksilverAgent.id,
  ...Object.values(BUSINESS_AGENT_DEFINITIONS).map((definition) => definition.id),
])
const PROFILE_FILE_MAX_BYTES = 64 * 1024
const MAX_SKILL_PROFILE_FILES = 64
const MAX_SKILL_SCAN_ENTRIES = 256
const ROUTINE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const profileKeys = new Set(['agentId', 'version', 'skillIds', 'routineIds', 'contextFiles'])

export interface WebAgentProfileDocument {
  schemaVersion: 1
  profiles: AgentProfileDefinition[]
}

export interface WebAgentProfileEnvironment {
  QUICKSILVER_AGENT_PROFILES_FILE?: string
  QUICKSILVER_SKILLS_DIR?: string
  QUICKSILVER_ROUTINES_DIR?: string
  QUICKSILVER_PROJECT_CONTEXT_ROOT?: string
  QUICKSILVER_AGENT_MEMORY_DIR?: string
  QUICKSILVER_TENANT_ID?: string
}

export interface WebAgentProfileResolverOptions {
  env?: Readonly<WebAgentProfileEnvironment>
  cwd?: string
  skillLibrary?: Pick<SkillLibrary, 'get'>
}

export type WebAgentProfileResolver = (agentId: string) => Promise<ResolvedAgentProfile | undefined>

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

type LibrarySkill = NonNullable<Awaited<ReturnType<SkillLibrary['get']>>>

async function loadReviewedSkillContent(skill: LibrarySkill): Promise<string> {
  const directoryInfo = await lstat(skill.dir)
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error('Reviewed skill directory must be a regular directory.')
  const libraryRoot = await realpath(resolve(skill.dir, '..', '..'))
  const activeRoot = await realpath(resolve(libraryRoot, 'active'))
  const activeRelative = relative(libraryRoot, activeRoot)
  if (!activeRelative || activeRelative === '..' || activeRelative.startsWith(`..${sep}`)) {
    throw new Error('Reviewed skill active directory escapes its configured library root.')
  }
  const directory = await realpath(skill.dir)
  const skillRelative = relative(activeRoot, directory)
  if (!skillRelative || skillRelative === '..' || skillRelative.startsWith(`..${sep}`)) {
    throw new Error('Reviewed skill directory escapes the active library root.')
  }
  const instructionsInfo = await lstat(join(directory, 'SKILL.md'))
  if (instructionsInfo.isSymbolicLink() || !instructionsInfo.isFile()) throw new Error('Reviewed skill instructions must be a regular file.')

  const description = `Description: ${skill.description}\n\n${skill.body}`
  if (description.length > MAX_AGENT_PROFILE_RESOURCE_CHARS) {
    throw new Error(`Reviewed skill exceeds the ${MAX_AGENT_PROFILE_RESOURCE_CHARS}-character profile resource limit.`)
  }
  const blocks = [description]
  let contentSize = description.length
  let scannedEntries = 0
  let fileCount = 0

  const walk = async (current: string): Promise<void> => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      scannedEntries += 1
      if (scannedEntries > MAX_SKILL_SCAN_ENTRIES) throw new Error('Reviewed skill contains too many files or directories.')
      if (!entry.name || entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes(':') || entry.name.includes('\0')) {
        throw new Error('Reviewed skill contains an unsafe file name.')
      }
      const path = join(current, entry.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error('Reviewed skill sidecars may not be symbolic links.')
      if (info.isDirectory()) {
        await walk(path)
        continue
      }
      if (!info.isFile()) throw new Error('Reviewed skill sidecars must be regular files.')
      const relativePath = relative(directory, path)
      if (relativePath === 'SKILL.md') continue
      const safePath = relativePath.split(sep).join('/')
      if (!safePath || safePath.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error('Reviewed skill sidecar path escapes its resource directory.')
      }
      fileCount += 1
      if (fileCount > MAX_SKILL_PROFILE_FILES) throw new Error(`Reviewed skill may include at most ${MAX_SKILL_PROFILE_FILES} sidecar files.`)
      const label = `[skill file: ${safePath}]\n`
      if (contentSize + label.length + info.size + 2 > MAX_AGENT_PROFILE_RESOURCE_CHARS) {
        throw new Error(`Reviewed skill exceeds the ${MAX_AGENT_PROFILE_RESOURCE_CHARS}-character profile resource limit.`)
      }
      const content = await readFile(path, 'utf8')
      const block = `${label}${content}`
      if (contentSize + block.length + 2 > MAX_AGENT_PROFILE_RESOURCE_CHARS) {
        throw new Error(`Reviewed skill exceeds the ${MAX_AGENT_PROFILE_RESOURCE_CHARS}-character profile resource limit.`)
      }
      blocks.push(block)
      contentSize += block.length + 2
    }
  }

  await walk(directory)
  return blocks.join('\n\n')
}

/** Parse the small, versioned, owner-managed profile file; unknown fields/agents fail closed. */
export function parseWebAgentProfileDocument(text: string): WebAgentProfileDocument {
  if (Buffer.byteLength(text, 'utf8') > PROFILE_FILE_MAX_BYTES) {
    throw new Error(`Agent profile file exceeds the ${PROFILE_FILE_MAX_BYTES}-byte limit.`)
  }
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Agent profile file must contain valid JSON.') }
  if (!object(raw) || Object.keys(raw).some((key) => !['schemaVersion', 'profiles'].includes(key))) {
    throw new Error('Agent profile file must be an object with only schemaVersion and profiles.')
  }
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.profiles)) {
    throw new Error('Agent profile file must use schemaVersion 1 and include a profiles array.')
  }

  const seen = new Set<string>()
  const profiles: AgentProfileDefinition[] = raw.profiles.map((candidate, index) => {
    if (!object(candidate) || Object.keys(candidate).some((key) => !profileKeys.has(key))) {
      throw new Error(`Agent profile entry ${index + 1} contains an unknown field.`)
    }
    const { agentId, version, skillIds, routineIds, contextFiles } = candidate
    if (typeof agentId !== 'string' || !WEB_AGENT_IDS.has(agentId)) {
      throw new Error(`Agent profile entry ${index + 1} names an unknown web agent.`)
    }
    if (!Number.isInteger(version) || Number(version) < 1) {
      throw new Error(`Agent profile for ${agentId} needs a positive integer version.`)
    }
    if (seen.has(agentId)) throw new Error(`Agent profile "${agentId}" is defined more than once.`)
    seen.add(agentId)
    for (const [label, value] of [['skillIds', skillIds], ['routineIds', routineIds], ['contextFiles', contextFiles]] as const) {
      if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))) {
        throw new Error(`Agent profile ${label} for ${agentId} must be an array of strings.`)
      }
    }
    return {
      agentId,
      version: Number(version),
      memoryDomain: `agent:${agentId}`,
      ...(skillIds === undefined ? {} : { skillIds: skillIds as string[] }),
      ...(routineIds === undefined ? {} : { routineIds: routineIds as string[] }),
      ...(contextFiles === undefined ? {} : { contextFiles: contextFiles as string[] }),
    }
  })
  return { schemaVersion: 1, profiles }
}

/** All governed web agents receive a private memory domain; file configuration only adds resources. */
export function buildWebAgentProfileRegistry(overrides: readonly AgentProfileDefinition[] = []): AgentProfileRegistry {
  const definitions = new Map<string, AgentProfileDefinition>()
  for (const agentId of WEB_AGENT_IDS) definitions.set(agentId, { agentId, version: 1, memoryDomain: `agent:${agentId}` })
  for (const override of overrides) {
    if (!WEB_AGENT_IDS.has(override.agentId)) throw new Error(`Cannot configure unknown web agent "${override.agentId}".`)
    if (override.memoryDomain !== undefined && override.memoryDomain !== `agent:${override.agentId}`) {
      throw new Error(`Agent profile memory must remain isolated to "${override.agentId}".`)
    }
    definitions.set(override.agentId, { ...override, memoryDomain: `agent:${override.agentId}` })
  }
  return new AgentProfileRegistry([...definitions.values()])
}

/** Construct a resolver once per server process; missing bound resources are errors, never silently skipped. */
export async function createWebAgentProfileResolver(options: WebAgentProfileResolverOptions = {}): Promise<WebAgentProfileResolver> {
  const env = options.env ?? process.env
  const cwd = resolve(options.cwd ?? process.cwd())
  const profileFile = env.QUICKSILVER_AGENT_PROFILES_FILE?.trim()
  let overrides: AgentProfileDefinition[] = []
  if (profileFile) {
    const path = resolve(cwd, profileFile)
    const info = await stat(path)
    if (!info.isFile()) throw new Error('Agent profile configuration must be a regular file.')
    if (info.size > PROFILE_FILE_MAX_BYTES) throw new Error(`Agent profile file exceeds the ${PROFILE_FILE_MAX_BYTES}-byte limit.`)
    overrides = parseWebAgentProfileDocument(await readFile(path, 'utf8')).profiles
  }
  const registry = buildWebAgentProfileRegistry(overrides)
  const skillRoot = env.QUICKSILVER_SKILLS_DIR?.trim() || join(homedir(), '.quicksilver', 'skills')
  const skills = options.skillLibrary ?? new SkillLibrary(skillRoot)
  const routineRoot = resolve(env.QUICKSILVER_ROUTINES_DIR?.trim() || join(homedir(), '.quicksilver', 'routines'))
  const projectRoot = resolve(env.QUICKSILVER_PROJECT_CONTEXT_ROOT?.trim() || cwd)

  return (agentId) => registry.resolve(agentId, {
    async loadSkill(id) {
      const skill = await skills.get(id)
      // Pending, revoked, malformed, or project-local skills are not profile resources.
      if (!skill || skill.source !== 'library') return undefined
      return { id, content: await loadReviewedSkillContent(skill) }
    },
    async loadRoutine(id) {
      if (!ROUTINE_ID.test(id)) return undefined
      const resource = await readProjectContextFile(routineRoot, `active/${id}.md`)
      return resource ? { id, content: resource.content } : undefined
    },
    loadProjectContext: (path) => readProjectContextFile(projectRoot, path),
  })
}

let resolverPromise: Promise<WebAgentProfileResolver> | undefined

/** Resolve a registered web worker profile from the active server configuration. */
export async function resolveWebAgentProfile(agentId: string): Promise<ResolvedAgentProfile | undefined> {
  resolverPromise ??= createWebAgentProfileResolver()
  return (await resolverPromise)(agentId)
}

export async function requireWebAgentProfile(agentId: string): Promise<ResolvedAgentProfile> {
  const profile = await resolveWebAgentProfile(agentId)
  if (!profile) throw new Error(`No governed profile is registered for web agent "${agentId}".`)
  return profile
}

const webAgentMemoryStores = new Map<string, FileMemoryStore>()
const segment = (value: string) => `id-${Buffer.from(value, 'utf8').toString('base64url')}`

/** Opt-in, tenant- and agent-partitioned file memory. FileMemoryStore requires one writer process per file. */
export function webAgentMemoryFor(agentId: string, env: Readonly<WebAgentProfileEnvironment> = process.env as WebAgentProfileEnvironment): MemoryStore | undefined {
  if (!WEB_AGENT_IDS.has(agentId)) throw new Error(`Cannot open memory for unknown web agent "${agentId}".`)
  const root = env.QUICKSILVER_AGENT_MEMORY_DIR?.trim()
  if (!root) return undefined
  const tenantId = env.QUICKSILVER_TENANT_ID?.trim() || 'default'
  const path = join(resolve(root), segment(tenantId), segment(agentId), 'memory.json')
  let store = webAgentMemoryStores.get(path)
  if (!store) {
    store = new FileMemoryStore(path)
    webAgentMemoryStores.set(path, store)
  }
  return store
}
