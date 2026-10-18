/**
 * Staged planner unit tests.
 *
 * Verifies stage 1 decomposition, stage 2a retrieval, stage 2b proposal, grounding guards,
 * and error resilience across stages.
 *
 * Run with: node --experimental-strip-types --no-warnings --test packages/agent/src/planner-staged.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { tool } from 'ai'
import { z } from 'zod'

import { planObjectiveStaged } from './planner-staged.ts'
import { languageModelForId } from './models.ts'

test('planObjectiveStaged completes all stages and returns validated grounded plan', async () => {
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const messages = body.messages || []
      const lastPrompt = messages[messages.length - 1]?.content || ''

      res.writeHead(200, { 'content-type': 'application/json' })
      if (lastPrompt.includes('Decompose this company objective')) {
        res.end(
          JSON.stringify({
            id: 'chatcmpl-1',
            object: 'chat.completion',
            created: 1,
            model: 'llama3.2:3b',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    decomposition: {
                      objective: 'Inspect primary irrigation pump',
                      constraints: ['Requires downtime'],
                      successMetrics: ['Telemetry verified'],
                      requiredCapabilities: ['cap-pump-inspection'],
                      candidateWorkstreams: ['pump-inspection-workstream'],
                    },
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
          }),
        )
      } else if (lastPrompt.includes('Before proposing anything, look up the real records')) {
        res.end(
          JSON.stringify({
            id: 'chatcmpl-2',
            object: 'chat.completion',
            created: 2,
            model: 'llama3.2:3b',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'get_records', arguments: '{}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          }),
        )
      } else if (lastPrompt.includes('Propose the candidate actions for THIS workstream only')) {
        res.end(
          JSON.stringify({
            id: 'chatcmpl-3',
            object: 'chat.completion',
            created: 3,
            model: 'llama3.2:3b',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    candidateActions: [
                      {
                        description: 'Perform pump telemetry inspection',
                        actorId: 'entity-water-pump-1',
                        capabilityId: 'cap-pump-inspection',
                        applicablePolicyIds: ['policy-maintenance-routine'],
                        evidenceIds: ['evidence-telemetry-baseline'],
                        financialExposure: 0,
                        reversible: true,
                        operationalImpact: 1,
                        uncertainty: 0,
                      },
                    ],
                    reasoning: 'Grounded in retrieved records.',
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70 },
          }),
        )
      } else {
        res.end(
          JSON.stringify({
            id: 'chatcmpl-fallback',
            object: 'chat.completion',
            created: 4,
            model: 'llama3.2:3b',
            choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          }),
        )
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  const prevMode = process.env.QUICKSILVER_MODEL_MODE
  const prevBaseUrl = process.env.QUICKSILVER_LOCAL_BASE_URL
  process.env.QUICKSILVER_MODEL_MODE = 'local'
  process.env.QUICKSILVER_LOCAL_BASE_URL = `http://127.0.0.1:${port}/v1`

  const tools = {
    get_records: tool({
      description: 'Retrieve system records',
      inputSchema: z.object({ query: z.string().optional() }),
      execute: async (_args) => [
        { id: 'entity-water-pump-1' },
        { id: 'cap-pump-inspection' },
        { id: 'policy-maintenance-routine' },
        { id: 'evidence-telemetry-baseline' },
      ],
    }),
  }

  try {
    const model = languageModelForId('llama3.2:3b', 'local')
    const result = await planObjectiveStaged(
      model,
      { objective: 'Inspect primary irrigation pump' },
      tools,
    )
    assert.equal(result.plan.candidateActions.length, 1)
    assert.equal(result.plan.candidateActions[0]!.actorId, 'entity-water-pump-1')
    assert.equal(result.plan.candidateActions[0]!.capabilityId, 'cap-pump-inspection')
    assert.equal(result.plan.decomposition.objective, 'Inspect primary irrigation pump')
  } finally {
    if (prevMode) process.env.QUICKSILVER_MODEL_MODE = prevMode
    else delete process.env.QUICKSILVER_MODEL_MODE
    if (prevBaseUrl) process.env.QUICKSILVER_LOCAL_BASE_URL = prevBaseUrl
    else delete process.env.QUICKSILVER_LOCAL_BASE_URL
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('planObjectiveStaged fails closed when no candidate actions are produced', async () => {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        id: 'chatcmpl-empty',
        object: 'chat.completion',
        created: 1,
        model: 'llama3.2:3b',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                decomposition: {
                  objective: 'Empty objective',
                  constraints: [],
                  successMetrics: [],
                  requiredCapabilities: [],
                  candidateWorkstreams: ['empty-workstream'],
                },
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }),
    )
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  const prevMode = process.env.QUICKSILVER_MODEL_MODE
  const prevBaseUrl = process.env.QUICKSILVER_LOCAL_BASE_URL
  process.env.QUICKSILVER_MODEL_MODE = 'local'
  process.env.QUICKSILVER_LOCAL_BASE_URL = `http://127.0.0.1:${port}/v1`

  try {
    const model = languageModelForId('llama3.2:3b', 'local')
    await assert.rejects(
      async () => {
        await planObjectiveStaged(model, { objective: 'Empty objective' }, {})
      },
      /Planner produced no candidate actions/,
    )
  } finally {
    if (prevMode) process.env.QUICKSILVER_MODEL_MODE = prevMode
    else delete process.env.QUICKSILVER_MODEL_MODE
    if (prevBaseUrl) process.env.QUICKSILVER_LOCAL_BASE_URL = prevBaseUrl
    else delete process.env.QUICKSILVER_LOCAL_BASE_URL
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
