/**
 * Capture the raw knowledge_base_read response for the knowledge base that backs the
 * chat, so a contradiction between two claims can be read directly rather than
 * described from memory.
 *
 * `verify:mcp` prints a 400-character summary. This writes the whole thing to
 * `kb-capture.json` and prints a short digest, including every field in the
 * response that looks like a contradiction, so the shape of the flagged pair can
 * be seen before anything is built on top of it.
 *
 * Needs SANITY_CONTEXT_KB_MCP_URL and a Context Viewer token
 * (SANITY_CONTEXT_TOKEN, or SANITY_CONTEXT_KB_TOKEN to override it).
 *
 *   npm run capture:kb --workspace=@quicksilver/agent
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createSanityContextClients, closeAll, mergeClientTools } from './mcp.ts'

const QUESTIONS = [
  'What caused the production downtime incidents, parameter drift or mechanical failure?',
  'Which policies apply to production parameter changes, and what evidence supports them?',
]

/** Every key path in `value` whose key or value mentions a contradiction. */
function findContradictionPaths(value: unknown, path = '', out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, i) => findContradictionPaths(item, `${path}[${i}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key
      if (/contradict|conflict|disagree|retract|supersede/i.test(key)) out.push(here)
      if (typeof child === 'string' && /contradict|conflict/i.test(child)) out.push(`${here} (value)`)
      findContradictionPaths(child, here, out)
    }
  }
  return out
}

function shorten(value: unknown, max = 200): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

async function main() {
  const url = process.env.SANITY_CONTEXT_KB_MCP_URL
  const token = process.env.SANITY_CONTEXT_KB_TOKEN || process.env.SANITY_CONTEXT_TOKEN
  if (!url || !token) {
    console.error('Set SANITY_CONTEXT_KB_MCP_URL and SANITY_CONTEXT_TOKEN (or SANITY_CONTEXT_KB_TOKEN).')
    process.exit(1)
  }

  const clients = await createSanityContextClients([{ endpointUrl: url, token, label: 'kb' }])
  try {
    const tools = await mergeClientTools(clients) as unknown as Record<string, {
      description?: string
      inputSchema?: unknown
      execute?: (args: unknown, options: unknown) => Promise<unknown>
    }>
    const read = tools.knowledge_base_read
    if (!read?.execute) {
      console.error(`knowledge_base_read is not exposed by ${url}. Tools: ${Object.keys(tools).join(', ') || '(none)'}`)
      process.exit(1)
    }

    console.log(`endpoint: ${url}`)
    console.log(`schema:   ${shorten(read.inputSchema, 1200)}\n`)

    const captured: Array<{ question: string; response: unknown }> = []
    for (const question of QUESTIONS) {
      console.log('─'.repeat(72))
      console.log(`Q: ${question}`)
      try {
        const response = await read.execute({ question }, { toolCallId: 'capture-kb', messages: [] })
        captured.push({ question, response })
        const text = JSON.stringify(response)
        console.log(`returned ${text.length} bytes`)
        const paths = [...new Set(findContradictionPaths(response))]
        if (paths.length) {
          console.log(`contradiction-shaped fields: ${paths.join(', ')}`)
          for (const p of paths.slice(0, 8)) console.log(`  ${p} = ${shorten(readAt(response, p), 300)}`)
        } else {
          console.log('no contradiction-shaped field found in this response')
        }
        console.log(shorten(response, 700))
      } catch (error) {
        console.log(`read failed: ${error instanceof Error ? error.message : 'unknown error'}`)
        captured.push({ question, response: { error: error instanceof Error ? error.message : 'unknown error' } })
      }
      console.log()
    }

    const out = resolve(process.cwd(), 'kb-capture.json')
    writeFileSync(out, JSON.stringify({ endpoint: url, capturedAt: new Date().toISOString(), captured }, null, 2))
    console.log(`full responses written to ${out}`)
  } finally {
    await closeAll(clients)
  }
}

/** Resolve a dotted path with `[]` indexes, for printing one flagged field. */
function readAt(root: unknown, path: string): unknown {
  let current: unknown = root
  for (const part of path.replace(/\[\d+\]/g, '').split('.').filter(Boolean)) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
