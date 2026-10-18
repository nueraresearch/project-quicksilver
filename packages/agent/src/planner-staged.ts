/**
 * Staged planning for local inference.
 *
 * Why. `PlanOutputSchema` is one object holding a five-field decomposition, an array of
 * nine-field action objects, and a rationale. Constrained decoding makes a small schema
 * genuinely reliable, but a 3B local model asked for all of that in a single response is
 * still a large ask, and when it misses, the whole plan is lost.
 *
 * The schema already has the seam built into it, so the stages follow it rather than an
 * invented one:
 *
 *   1. decomposition            — five scalar/string-array fields, no cross-references
 *   2. actions, per workstream  — one call each, so a failure costs one workstream
 *   3. assemble + validate      — against the real PlanOutputSchema, or throw
 *
 * What this deliberately does NOT change:
 *
 * - The kernel still sees exactly one complete plan, validated by the same
 *   `PlanOutputSchema` it always saw. Stages 1 and 2 are the model's *proposal* step, not
 *   the kernel's evaluation; nothing here touches evaluation, authorization or approval.
 * - Fail-closed is preserved. Every stage boundary is a zod parse, and a stage that
 *   returns nothing usable throws the same error the single-shot path throws.
 * - Cloud and azure never reach this module. `planObjective` only calls it in local mode,
 *   so the verified production path is untouched.
 */

import { generateText, stepCountIs, type LanguageModel } from 'ai'

import { PLANNER_SYSTEM_PROMPT } from './prompts.ts'
import {
  ActionsStageSchema,
  DecompositionStageSchema,
  PlanOutputSchema,
  type Decomposition,
} from './planner-schemas.ts'
// Types only — a value import here would close an import cycle with the module that calls
// this one.
import type { PlannerInput, PlannerOutput } from './planner.ts'
import { readStructuredOutput, structuredOutputOption } from './structured-output.ts'
import { groundActions, instrumentTools } from './grounding.ts'
import { formatAgentContext } from './profile-context.ts'
import { normalizeModelTokenUsage } from './usage.ts'

/** Cap the fan-out so a model cannot make this unbounded by naming many workstreams. */
const MAX_WORKSTREAMS = 6
const MAX_ACTIONS_PER_WORKSTREAM = 5
const STAGE_MAX_RETRIES = 2
/**
 * Stage 2 is the only stage that still needs a tool loop — it is the only one whose
 * schema carries document IDs that must be real. Bounded much tighter than the
 * single-shot planner's 15: each extra step is another full round trip on a small model
 * with a growing context, and a workstream rarely needs more than a couple of lookups.
 */
const TOOL_LOOP_MAX_STEPS = 6
/** Bounds on what stage 2b is shown, so a chatty tool cannot blow the prompt. */
const MAX_EVIDENCE_CHUNKS = 8
const MAX_EVIDENCE_CHARS = 6000

function contextSuffix(input: PlannerInput): string {
  return formatAgentContext(input.agentContext)
}

/**
 * Stage 1 — the decomposition, and nothing else.
 *
 * Deliberately a single step with NO tools. `DecompositionSchema` holds only free text —
 * objective, constraints, successMetrics, requiredCapabilities, candidateWorkstreams —
 * and every field that must cite a real document (`actorId`, `capabilityId`,
 * `applicablePolicyIds`, `evidenceIds`) lives in stage 2. So there is nothing here that a
 * tool lookup could ground.
 *
 * That matters more than it looks: the multi-step tool loop is the part a small local
 * model is worst at, because it must decide on its own whether to call again or finish.
 * Removing tools removes that decision entirely and leaves a small, fully-constrained
 * generation, which is the case constrained decoding is actually good at.
 */
async function planDecomposition(
  model: LanguageModel,
  input: PlannerInput,
): Promise<{ decomposition: Decomposition; totalUsage: unknown }> {
  const result = await generateText({
    model,
    system: PLANNER_SYSTEM_PROMPT,
    prompt: `Decompose this company objective into distinct workstreams.

"""${input.objective}"""

This step is only the breakdown — do not propose actions and do not cite document IDs, you have no company records here and must not invent any.

List the constraints that bound the objective, the success metrics that would show it was met, the capabilities it requires, and the candidate workstreams.${contextSuffix(input)}`,
    ...structuredOutputOption(DecompositionStageSchema, 'local'),
    maxRetries: STAGE_MAX_RETRIES,
  } as never)

  const parsed = readStructuredOutput<{ decomposition: Decomposition }>(result, 'local')
  if (!parsed?.decomposition) throw new Error('Planner produced no decomposition.')
  return { decomposition: parsed.decomposition, totalUsage: result.totalUsage }
}

/**
 * Stage 2 — the actions for one workstream, split into retrieval and proposal.
 *
 * Measured cause for the split. With an identical prompt, tool and model:
 *
 *   tools + no output constraint  ->  17.8s, toolCalls=1 ["searchEntities"],
 *                                    text cites the REAL "entity-engineering-agent"
 *   tools + json_schema constraint -> 28.8s, toolCalls=0,
 *                                    invents "entity-cnc-3-controller"
 *
 * A JSON-schema grammar forces the completion to satisfy that schema, and a tool call
 * cannot, so the constraint wins and the model fabricates an id to satisfy it. Constrained
 * decoding and tool calling are not merely awkward together in a local model — they are
 * mutually exclusive. So each gets its own call:
 *
 *   2a retrieve — tools, deliberately UNCONSTRAINED. This is the call that makes tool
 *                calls possible, and it is the measured-good configuration.
 *   2b propose  — no tools at all; the retrieved records and the exact ids they contain
 *                are placed in the prompt, and only then is the schema constraint applied.
 *
 * That ordering also makes grounding structural rather than hopeful: by the time 2b runs,
 * the real ids are already in its context, and the grounding guard independently rejects
 * anything that is not among them.
 *
 * Returned rather than thrown so one workstream can fail without discarding the stages
 * that already succeeded.
 */
async function planWorkstreamActions(
  model: LanguageModel,
  input: PlannerInput,
  workstream: string,
  decomposition: Decomposition,
  tools: unknown,
  grounded: Set<string>,
): Promise<{ actions: PlannerOutput['candidateActions']; reasoning: string; totalUsage: unknown[] } | null> {
  // 2a — retrieve. Tools are available and nothing is constrained, which is the only
  // configuration in which this model actually calls them.
  const evidence: string[] = []
  const retrievable = instrumentTools((tools ?? {}) as Record<string, unknown>, grounded, evidence)
  const retrieved = await generateText({
    model,
    system: PLANNER_SYSTEM_PROMPT,
    prompt: `Objective: """${decomposition.objective}"""

This is ONE workstream of the plan: "${workstream}"

Before proposing anything, look up the real records you need: which entity would carry out the action, which capability it needs, which policies apply, and what evidence is relevant. Use the tools to retrieve them now. Do not propose actions in this step.`,
    tools: retrievable as never,
    stopWhen: stepCountIs(TOOL_LOOP_MAX_STEPS),
    maxRetries: STAGE_MAX_RETRIES,
  } as never)

  if (evidence.length === 0) {
    // Nothing was retrieved, so nothing can be grounded. Returning null lets the caller
    // drop this workstream instead of proposing actions from nothing.
    return null
  }

  // 2b — propose. No tools, so the schema constraint has nothing to compete with.
  const proposed = await generateText({
    model,
    system: PLANNER_SYSTEM_PROMPT,
    prompt: `Objective: """${decomposition.objective}"""

This is ONE workstream of the plan: "${workstream}"

Known constraints: ${decomposition.constraints.join('; ') || 'none stated'}

Here are the records retrieved for this workstream:

${evidence.slice(0, MAX_EVIDENCE_CHUNKS).join('\n').slice(0, MAX_EVIDENCE_CHARS)}

Propose the candidate actions for THIS workstream only (at most ${MAX_ACTIONS_PER_WORKSTREAM}).

Every actorId and capabilityId MUST be one of the exact identifiers listed in the records above — copy them verbatim. An action with a blank actorId or capabilityId will be discarded, because the kernel cannot authorize work that names no one.

Use applicablePolicyIds and evidenceIds only from the same list. Never invent an identifier; a plausible-looking invented one is far more dangerous than a blank, because the kernel would authorize it against a record that does not exist.${contextSuffix(input)}`,
    ...structuredOutputOption(ActionsStageSchema, 'local'),
    maxRetries: STAGE_MAX_RETRIES,
  } as never)

  const parsed = readStructuredOutput<{ candidateActions: PlannerOutput['candidateActions']; reasoning: string }>(proposed, 'local')
  if (!parsed?.candidateActions?.length) return null
  return { actions: parsed.candidateActions, reasoning: parsed.reasoning ?? '', totalUsage: [retrieved.totalUsage, proposed.totalUsage] }
}

/**
 * Run the staged plan and return a single object in the planner's normal shape.
 *
 * The assembled value is parsed by `PlanOutputSchema` before it is returned, so a caller
 * cannot receive something the kernel would have rejected.
 */
export async function planObjectiveStaged(
  model: LanguageModel,
  input: PlannerInput,
  tools: unknown,
): Promise<{ plan: Omit<PlannerOutput, 'toolCalls' | 'modelId' | 'usage'>; usage: unknown }> {
  const stage1 = await planDecomposition(model, input)
  const workstreams = stage1.decomposition.candidateWorkstreams.filter((w) => w.trim().length > 0)

  if (workstreams.length === 0) {
    // Nothing to expand. Fall back to treating the objective itself as the single
    // workstream rather than returning a plan with no actions, which would fail closed
    // on the caller's existing check anyway.
    workstreams.push(decompositionObjectiveFallback(stage1.decomposition.objective))
  }

  const chosen = workstreams.slice(0, MAX_WORKSTREAMS)

  // Every id the tools actually return during this run is the only ground truth available.
  // Measured on llama3.2:3b: with a single constrained call and tools present, the model
  // called nothing and invented every id it cited.
  const grounded = new Set<string>()

  const settled = await Promise.all(
    chosen.map((w) => planWorkstreamActions(model, input, w, stage1.decomposition, tools, grounded).catch(() => null)),
  )

  const proposed = settled.flatMap((s) => s?.actions ?? [])
  if (proposed.length === 0) {
    throw new Error('Planner produced no candidate actions.')
  }

  const { grounded: candidateActions, rejected } = groundActions(proposed, grounded)
  if (rejected.length > 0) {
    // Diagnostic only — this never changes the outcome, it just records what was dropped
    // and why, so a local run that quietly loses actions is visible rather than puzzling.
    console.warn(
      `[planner:local] dropped ${rejected.length}/${proposed.length} action(s) citing ids no tool returned: ` +
        rejected.slice(0, 3).flatMap((r) => r.ungrounded).slice(0, 6).join(', '),
    )
  }
  if (candidateActions.length === 0) {
    // Fail closed. A plan whose every action references records that do not exist would be
    // authorized against capabilities the company never granted.
    throw new Error(
      `Planner produced ${proposed.length} action(s) but none cited a record any tool actually returned; refusing to propose an ungrounded plan.`,
    )
  }

  const reasoning = settled
    .map((s) => s?.reasoning ?? '')
    .filter(Boolean)
    .join(' ')

  // The same schema the single-shot path satisfies, and the same failure: a malformed
  // assembled plan throws here rather than reaching the kernel half-formed.
  const plan = PlanOutputSchema.parse({
    decomposition: stage1.decomposition,
    candidateActions,
    reasoning: reasoning || `Decomposed into: ${chosen.join('; ')}`,
  })

  // Sum the real per-stage usage rather than reporting stage 1 alone or inventing zero:
  // a staged run costs several calls, and a usage record that undercounts it would make
  // cost reporting quietly wrong for exactly the mode that has no billing provider to
  // reconcile against.
  const stages = [stage1.totalUsage, ...settled.map((s) => s?.totalUsage)]
  return { plan, usage: sumUsage(stages) }
}

function sumUsage(values: unknown[]): { inputTokens?: number; outputTokens?: number; totalTokens?: number } {
  const out: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {}
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    const usage = value as Record<string, unknown>
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
      const n = usage[key]
      if (typeof n === 'number' && Number.isFinite(n)) {
        out[key] = (out[key] ?? 0) + Math.floor(n)
      }
    }
  }
  return out
}

function decompositionObjectiveFallback(objective: string): string {
  return `Carry out the objective directly: ${objective.slice(0, 200)}`
}