/**
 * Local (Ollama) structured output must use constrained decoding.
 *
 * Why this test intercepts real HTTP instead of trusting internals: `generateText`
 * can appear to succeed while constraining nothing. `JSON.stringify(PlanOutputSchema)`
 * produces a 196-byte object with no `required` array, and a local model will happily
 * return valid JSON for it — a false positive that was nearly reported as a result.
 * The only trustworthy evidence is the `response_format` that actually leaves the process.
 *
 * A throwaway HTTP server stands in for Ollama: OLLAMA_BASE_URL points at it, the
 * unmodified `languageModelForId` builds a real model, and we read the request body
 * the AI SDK put on the wire.
 *
 * Run with:   node --experimental-strip-types --no-warnings --test src/local-structured-output.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { generateText, zodSchema } from 'ai'
import { z } from 'zod'

import { languageModelForId, getMode } from './models.ts'
import { structuredOutputOption } from './structured-output.ts'
import { PlanOutputSchema } from './planner.ts'

type Json = Record<string, unknown>

const CHAT_REPLY = JSON.stringify({
  id: 'chatcmpl-local-test',
  object: 'chat.completion',
  created: 1,
  model: 'llama3.2:3b',
  choices: [
    { index: 0, message: { role: 'assistant', content: '{"answer":"ok"}' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
})

/** Run `fn` with the given env applied, then restore the previous values exactly. */
async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>()
  for (const [k, v] of Object.entries(patch)) {
    saved.set(k, process.env[k])
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return await fn()
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/** Start a throwaway server, run `fn` against it, and always close it. */
async function captureRequestBody(fn: (baseURL: string) => Promise<void>): Promise<Json> {
  const bodies: string[] = []
  const server: Server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(CHAT_REPLY)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await fn(`http://127.0.0.1:${port}/v1`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  assert.equal(bodies.length, 1, `expected exactly one outbound request, saw ${bodies.length}`)
  return JSON.parse(bodies[0]!) as Json
}

const ReplySchema = z.object({ answer: z.string() })

test('local mode sends response_format json_schema so the model is constrained, not merely asked', async () => {
  await withEnv({ QUICKSILVER_MODEL_MODE: 'local', OLLAMA_BASE_URL: undefined }, async () => {
    const body = await captureRequestBody(async (baseURL) => {
      await withEnv({ OLLAMA_BASE_URL: baseURL }, async () => {
        const model = languageModelForId('llama3.2:3b', 'local')
        await generateText({
          model,
          prompt: 'Reply.',
          ...structuredOutputOption(ReplySchema, 'local'),
        } as never)
      })
    })

    const responseFormat = body.response_format as Json | undefined
    assert.ok(
      responseFormat,
      'the outbound request carried no response_format: local mode is asking for JSON, not constraining it',
    )
    assert.equal(responseFormat.type, 'json_schema')

    const jsonSchema = (responseFormat.json_schema as Json | undefined)?.schema as Json | undefined
    assert.ok(jsonSchema, 'response_format.json_schema.schema is missing')
    assert.deepEqual(jsonSchema.properties, { answer: { type: 'string' } })
    assert.deepEqual(jsonSchema.required, ['answer'])
  })
})

test('the schema actually sent for the real planner output is strict', () => {
  // Azure/OpenAI strict mode rejects a schema whose `required` omits a key present in
  // `properties`, and a local json_schema constraint is only as strict as the schema it
  // is given. The planner schema is large and this project has shipped this exact bug
  // three times. Asserted on the conversion the SDK performs, which is what reaches the
  // wire — no HTTP round trip needed, and none here to leak a server handle.
  const json = zodSchema(PlanOutputSchema as never).jsonSchema as Json
  const missing = collectMissing(json as never)
  assert.deepEqual(missing, [], `properties absent from "required": ${missing.join(', ')}`)
  assert.equal(json.additionalProperties, false, 'a strict constraint also forbids extra properties')
})

test('the injection is local-scoped: cloud and azure keep the option they had', () => {
  // If constrained decoding ever leaked into Azure or the direct providers, those would
  // start receiving a second, conflicting shape constraint alongside the one they
  // already apply — on a path whose production behaviour is verified and which no local
  // test could prove safe to change.
  const local = structuredOutputOption(ReplySchema, 'local')
  assert.ok('output' in local, 'local mode must request the schema via `output`')
  assert.ok(!('experimental_output' in local), 'local mode must not also send the legacy option')

  for (const mode of ['azure', 'cloud'] as const) {
    const other = structuredOutputOption(ReplySchema, mode)
    assert.ok('experimental_output' in other, `${mode} mode must keep experimental_output`)
    assert.ok(!('output' in other), `${mode} mode must not be switched to \`output\``)
  }
})

test('with no credentials and no override, the mode still resolves and picks its option', async () => {
  await withEnv({ QUICKSILVER_MODEL_MODE: undefined, AZURE_API_KEY: undefined, AZURE_RESOURCE_NAME: undefined, OPENAI_API_KEY: undefined }, async () => {
    // With nothing configured the mode falls back to local (getMode's documented default),
    // and the option must follow the mode rather than a hardcoded branch.
    assert.equal(getMode(), 'local')
    assert.ok('output' in structuredOutputOption(ReplySchema))
  })
})

/** Every property key missing from its own `required` array, recursively. */
function collectMissing(schema: Json & { properties?: Record<string, Json>; required?: string[]; items?: Json | Json[]; anyOf?: Json[] }, path = '$'): string[] {
  const out: string[] = []
  if (schema.properties) {
    const required = new Set(schema.required ?? [])
    for (const k of Object.keys(schema.properties)) {
      if (!required.has(k)) out.push(`${path}.${k}`)
      out.push(...collectMissing(schema.properties[k]!, `${path}.${k}`))
    }
  }
  const items = schema.items
  if (Array.isArray(items)) items.forEach((it, i) => out.push(...collectMissing(it, `${path}[${i}]`)))
  else if (items) out.push(...collectMissing(items, `${path}[]`))
  for (const alt of schema.anyOf ?? []) out.push(...collectMissing(alt, path))
  return out
}