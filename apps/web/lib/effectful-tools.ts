/**
 * What this deployment can actually do, in the console's own words.
 *
 * The console records decisions; it does not send anything to the outside world. A person
 * who presses Approve or Execute is entitled to know that before they press it, rather
 * than discovering it from a marketing page — especially an asynchronous reader evaluating
 * the project on their own.
 *
 * The effectful tools are declared here rather than imported from the host, because the
 * console must not depend on the host process. `effectful-tools.test.ts` reads the host's
 * tool manifests and fails if this list drifts from them, so the two cannot disagree
 * silently.
 */

export interface EffectfulToolDisclosure {
  id: string
  /** What the tool would do, in one line. */
  effect: string
  /** What the console does instead. */
  consoleMode: 'dry-run'
  /**
   * The exact configuration that makes the tool live. The default is always the dry run:
   * a tool goes live only when its settings are in the policy file *and* its secret is
   * in the environment, so an unconfigured deployment cannot emit anything by accident.
   */
  liveRequires: readonly string[]
  /** Approval is always required, and always by a human who did not propose the action. */
  requiresHumanApproval: true
}

const APPROVAL_NOTE = 'A verified approval by a different human, bound to the exact action and policy version.'

export const EFFECTFUL_TOOLS: readonly EffectfulToolDisclosure[] = Object.freeze([
  Object.freeze({
    id: 'notification.send',
    effect: 'Email a verified recipient through Resend.',
    consoleMode: 'dry-run' as const,
    liveRequires: Object.freeze(['QUICKSILVER_ACTIONS_CONFIG (with an `email` block)', 'QUICKSILVER_EMAIL_API_KEY']),
    requiresHumanApproval: true as const,
  }),
  Object.freeze({
    id: 'webhook.dispatch',
    effect: 'Send a signed payload to an allowed external host.',
    consoleMode: 'dry-run' as const,
    liveRequires: Object.freeze(['QUICKSILVER_ACTIONS_CONFIG (with a `webhook` block)', 'QUICKSILVER_ACTIONS_WEBHOOK_SECRET']),
    requiresHumanApproval: true as const,
  }),
  Object.freeze({
    id: 'sanity.mutate',
    effect: 'Apply an approved metadata mutation in the dedicated Sanity project.',
    consoleMode: 'dry-run' as const,
    // There is deliberately no live path for this one: a generic "apply this mutation"
    // tool is too broad to approve safely, so each mutation gets its own narrow executor.
    liveRequires: Object.freeze(['no live adapter ships; a per-mutation executor is required instead']),
    requiresHumanApproval: true as const,
  }),
])

export interface ExecutionDisclosure {
  consoleMode: 'simulated'
  detail: string
  reproducible: boolean
}

/** What "Execute" does in this deployment. */
export const CONSOLE_EXECUTION: ExecutionDisclosure = Object.freeze({
  consoleMode: 'simulated' as const,
  detail:
    'Execute records the approved action and a deterministic simulated result against a metric. ' +
    'Nothing leaves this deployment. The same decision always produces the same outcome, so a reader ' +
    'replaying it sees exactly what the author saw.',
  reproducible: true,
})

export interface ActionsDisclosure {
  execution: ExecutionDisclosure
  tools: readonly EffectfulToolDisclosure[]
  approval: string
}

export function describeActions(): ActionsDisclosure {
  return {
    execution: CONSOLE_EXECUTION,
    tools: EFFECTFUL_TOOLS,
    approval: APPROVAL_NOTE,
  }
}
