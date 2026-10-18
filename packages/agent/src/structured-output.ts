/**
 * Mode-scoped structured output.
 *
 * Why this exists. AI SDK 6 still accepts the legacy `experimental_output` option and
 * silently accepts it — the call succeeds, the model returns *something*, and the only
 * sign that nothing was constrained is that the request carried no `response_format` at
 * all. Measured on this codebase: with `experimental_output`, the outbound body was
 * `{model, messages}`. With `output`, the same call produced
 * `response_format: {type: "json_schema", json_schema: {schema, strict: true}}`.
 *
 * That distinction is the whole game for local inference. A model handed a schema can be
 * made to obey it by constrained decoding; a model merely *asked* for JSON has to get
 * every brace right unaided, which a small local model does not reliably do.
 *
 * Scope: local mode only. Azure and the direct providers keep `experimental_output`,
 * byte for byte, because their current behaviour is what production is verified against
 * and there is no local test that could prove a change to that path safe.
 */

import { Output } from 'ai'
import type { z } from 'zod'
import { getMode, type InferenceMode } from './models.ts'

/**
 * The `generateText` options fragment that requests a schema.
 *
 * Local mode sends `output`, which makes the SDK emit `response_format` with the JSON
 * Schema converted from `schema`. Every other mode sends `experimental_output`, exactly
 * as before this change.
 */
export function structuredOutputOption(
  schema: z.ZodTypeAny,
  mode: InferenceMode = getMode(),
): { output: ReturnType<typeof Output.object> } | { experimental_output: ReturnType<typeof Output.object> } {
  return mode === 'local'
    ? { output: Output.object({ schema: schema as never }) }
    : { experimental_output: Output.object({ schema: schema as never }) }
}

/**
 * Read the parsed result back, from whichever field the SDK populated.
 *
 * Returns `undefined` rather than throwing so callers keep their existing
 * "model did not return structured output" failure path — a missing structured result
 * must stay an error, never a silently-defaulted empty object.
 */
export function readStructuredOutput<T>(result: unknown, mode: InferenceMode = getMode()): T | undefined {
  if (result == null || typeof result !== 'object') return undefined
  const r = result as { output?: T; experimental_output?: T }
  const value = mode === 'local' ? r.output : r.experimental_output
  return value ?? undefined
}