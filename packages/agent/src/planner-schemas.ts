/**
 * The planner's output schemas, in their own module.
 *
 * Split out so `planner.ts` and `planner-staged.ts` can both use the same definitions
 * without importing each other. A cycle here would be a runtime hazard for no benefit:
 * the two files define a single schema set, and duplication would let the staged planner
 * drift from the schema its assembled output is finally validated against — which is
 * exactly the failure this split exists to prevent.
 */

import { z } from 'zod'

export const ProposedActionSchema = z.object({
  description: z.string(),
  actorId: z.string(),
  capabilityId: z.string(),
  applicablePolicyIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  // Required (not `.default(0)`): strict JSON-schema output needs every property in `required`.
  financialExposure: z.number().describe('Estimated financial exposure in USD; use 0 if none'),
  reversible: z.boolean(),
  operationalImpact: z.number().int().min(0).max(5),
  uncertainty: z.number().int().min(0).max(5),
})

export const DecompositionSchema = z.object({
  objective: z.string(),
  constraints: z.array(z.string()),
  successMetrics: z.array(z.string()),
  requiredCapabilities: z.array(z.string()),
  candidateWorkstreams: z.array(z.string()),
})

export const PlanOutputSchema = z.object({
  decomposition: DecompositionSchema,
  candidateActions: z.array(ProposedActionSchema).min(1),
  reasoning: z.string(),
})

/**
 * Stage schemas for the local planner. They reuse `DecompositionSchema` and
 * `ProposedActionSchema` rather than restating them, so the stages cannot drift from the
 * schema the assembled plan is finally validated against.
 */
export const DecompositionStageSchema = z.object({ decomposition: DecompositionSchema })

export const ActionsStageSchema = z.object({
  candidateActions: z.array(ProposedActionSchema).min(1),
  reasoning: z.string(),
})

export type Decomposition = z.infer<typeof DecompositionSchema>
export type ProposedActionShape = z.infer<typeof ProposedActionSchema>