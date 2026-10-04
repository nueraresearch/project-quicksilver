/**
 * Objectives the demo seeds through the real planner (scripts/demo-seed-decisions.ts), so the decisions
 * waiting for approval are genuine: drafted by the planner agent, checked by the kernel, read by the
 * reviewer, with a real explanation and a real fingerprint. Written against the seed company
 * (apps/studio/seed): Operations Policy 17, Budget Policy 3, Quality Policy 8 and the CNC line.
 *
 * What the planner and kernel answer is not scripted: a model drafts each plan, so the script reports
 * what came back. The aim of each objective is what it is expected to show.
 */

export interface DemoObjective {
  id: string
  objective: string
  /** What this one is meant to show a judge; not used by the planner. */
  shows: string
}

export const DEMO_OBJECTIVES: readonly DemoObjective[] = Object.freeze([
  {
    id: 'cnc2-drift',
    objective: 'CNC 2 controller parameter X has drifted since the June vendor bulletin. Propose how to correct it within Operations Policy 17, without a new purchase or extra headcount.',
    shows: 'A parameter change that needs a VP to approve, with the policy conflict visible in the why.',
  },
  {
    id: 'spindle-budget',
    objective: 'Reallocate $60,000 from the training budget to replace the failing spindle on CNC Machine 1 before the next production run.',
    shows: 'A spend above the $50,000 threshold in Budget Policy 3, which a human must approve.',
  },
  {
    id: 'maintenance-window',
    objective: 'Schedule preventive maintenance on CNC Machine 1 this week in a way that does not delay any customer shipment.',
    shows: 'A lower-risk action, to compare against the two above.',
  },
  {
    id: 'skip-inspection',
    objective: 'To hit this Friday\'s delivery deadline, skip the pre-shipment quality inspection on the aerospace order.',
    shows: 'An action the policies should refuse, so the near-miss ("what would change the answer") can be seen.',
  },
])

export function validateDemoObjectives(list: readonly DemoObjective[] = DEMO_OBJECTIVES): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!/^[a-z0-9-]{3,40}$/.test(item.id)) problems.push(`${item.id}: id must be 3 to 40 lowercase letters, digits or hyphens`)
    if (seen.has(item.id)) problems.push(`${item.id}: duplicate id`)
    seen.add(item.id)
    // the plan route accepts 3 to 2,000 characters
    if (item.objective.trim().length < 3 || item.objective.length > 2_000) problems.push(`${item.id}: objective must be 3 to 2,000 characters`)
    if (!item.shows.trim()) problems.push(`${item.id}: say what it is meant to show`)
  }
  return problems
}
