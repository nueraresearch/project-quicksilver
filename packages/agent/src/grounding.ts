/**
 * Grounding for locally-planned actions.
 *
 * Why this exists. Measured on llama3.2:3b: stage 2 made **zero** tool calls and returned a
 * schema-perfect action list in which every identifier was invented —
 * `entity-cnc-3-controller`, `cap-entity-cnc-3-controller`,
 * `policy-cnc-3-controller-param-change`. The shape was perfect and the content was
 * fiction.
 *
 * That matters more than a quality complaint, because the kernel computes risk and
 * authorization *from these identifiers*. An action referencing a capability that does not
 * exist can be authorized with confident, wrong reasoning. So an action that cites an id
 * the planner never actually retrieved is not a weak suggestion — it is an unsafe one, and
 * it is dropped rather than passed along.
 *
 * The ground truth is the tool output itself, captured at call time. `EvaluatorToolCall`
 * cannot serve: it records the tool's name and whether it succeeded, but never its result,
 * by design. That is the right call for telemetry and useless for verification, so the ids
 * are collected here instead — from the values that came back, which no prompt can inflate.
 *
 * Fail-closed by construction: if the model called no tools, nothing is grounded, every
 * action is rejected, and the planner throws. Silence is not permission.
 */

/** Ids this codebase actually uses, by prefix. Deliberately narrow: a generic string is not an id. */
const ID_PATTERN =
  /^(entity|cap|policy|evidence|metric|decision|agent|workflow|doc)-[a-z0-9][a-z0-9-]*$/i

const ID_KEYS = ['_id', 'id', 'ref', '_ref'] as const

/**
 * Every document id appearing anywhere in a tool result.
 *
 * Walked recursively rather than assumed to be a fixed shape: MCP tools return whatever the
 * dataset holds, and a grounding check that silently misses a nested `_id` would be worse
 * than none — it would reject real ids while accepting invented ones.
 */
export function collectIds(value: unknown, into: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 12 || value == null) return into

  if (typeof value === 'string') {
    if (ID_PATTERN.test(value)) into.add(value)
    return into
  }

  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, into, depth + 1)
    return into
  }

  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if ((ID_KEYS as readonly string[]).includes(key) && typeof entry === 'string' && ID_PATTERN.test(entry)) {
        into.add(entry)
        continue
      }
      collectIds(entry, into, depth + 1)
    }
  }
  return into
}

type AnyTool = { execute?: (args: unknown, options: unknown) => unknown } & Record<string, unknown>

/**
 * Wrap tools so every result feeds the grounding index.
 *
 * `evidence`, when supplied, receives a bounded rendering of each result as well. The
 * staged planner uses it to hand the *records themselves* to the proposing call: the
 * proposing call has no tools, so without this it would be reasoning about ids it has
 * never seen — which is precisely the failure the split exists to fix.
 *
 * Wrapping rather than re-querying keeps this independent of the backing store: it works
 * identically over Sanity Context MCP today and over whatever replaces it, which is the
 * whole point of not hard-coding a storage dependency into a safety check.
 *
 * A tool that throws still has its error surface — the caller's existing `toolCalls`
 * record is updated by `mergeClientTools` independently of this wrapper.
 */
export function instrumentTools<T extends Record<string, unknown>>(
  tools: T,
  grounded: Set<string>,
  evidence?: string[],
): T {
  const wrapped: Record<string, unknown> = {}
  for (const [name, tool] of Object.entries(tools ?? {})) {
    const candidate = tool as AnyTool | undefined
    if (!candidate || typeof candidate.execute !== 'function') {
      wrapped[name] = tool
      continue
    }
    const original = candidate.execute.bind(candidate)
    wrapped[name] = {
      ...candidate,
      execute: async (args: unknown, options: unknown) => {
        const result = await original(args, options)
        collectIds(result, grounded)
        if (evidence) {
          const rendered = renderEvidence(result)
          // Pushing an empty render would leave a bare "[toolName] " label in the prompt
          // and consume one of the bounded evidence slots for no information.
          if (rendered) evidence.push(`[${name}] ${rendered}`)
        }
        return result
      },
    }
  }
  return wrapped as T
}

/** A bounded, readable rendering of a tool result for the next prompt. */
function renderEvidence(result: unknown): string {
  try {
    const text = typeof result === 'string' ? result : JSON.stringify(result)
    if (!text) return ''
    return text.length > MAX_EVIDENCE_CHARS ? `${text.slice(0, MAX_EVIDENCE_CHARS)}…[truncated]` : text
  } catch {
    // A result that cannot be stringified is not usable as prompt evidence. Returning ''
    // keeps it out of the prompt rather than emitting "undefined" or throwing mid-plan.
    return ''
  }
}

const MAX_EVIDENCE_CHARS = 2000

/** An action's document references, as they appear in ProposedActionSchema. */
export interface ActionReferences {
  /** Not a reference; carried so a rejected action can still be reported in full. */
  description?: string
  actorId: string
  capabilityId: string
  applicablePolicyIds: readonly string[]
  evidenceIds: readonly string[]
}

export interface GroundingResult<T> {
  /** Actions every reference of which was actually retrieved by a tool. */
  grounded: T[]
  /** Actions dropped, with the ids that were not found. Never returned to the kernel. */
  rejected: Array<{ action: T; ungrounded: string[] }>
}

/**
 * Keep only the actions whose every cited id was returned by a tool during this run.
 *
 * All-or-nothing per action, not per field: an action with a real actor but an invented
 * capability is exactly the case that produces a confidently wrong authorization, and
 * half-validating it would hide the defect behind a plausible-looking result.
 */
export function groundActions<T extends ActionReferences>(actions: readonly T[], grounded: ReadonlySet<string>): GroundingResult<T> {
  const kept: T[] = []
  const rejected: GroundingResult<T>['rejected'] = []

  for (const action of actions) {
    const cited = [action.actorId, action.capabilityId, ...action.applicablePolicyIds, ...action.evidenceIds]
    const ungrounded = [...new Set(cited.filter((id) => !grounded.has(id)))]
    if (ungrounded.length === 0) kept.push(action)
    else rejected.push({ action, ungrounded })
  }

  return { grounded: kept, rejected }
}