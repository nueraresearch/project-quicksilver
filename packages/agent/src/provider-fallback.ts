import {
  getMode,
  languageModelForId,
  modelForRole,
  resolveId,
  readMeasuredRoutingConfig,
  routeForRole,
  type MeasuredRoutingConfig,
  type QuicksilverModelRole,
} from './models.ts'
import type { LanguageModel } from 'ai'
import { appendModelRoutingOutcome, loadModelRoutingProfiles } from './routing-history.ts'
import type { RoutingOutcome } from '@quicksilver/kernel'

const ROLE_TASK: Record<QuicksilverModelRole, RoutingOutcome['taskType']> = {
  planner: 'planning', reviewer: 'evaluation', router: 'routing', executor: 'code',
}

function rateLimitedFailure(error: unknown): boolean | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = error as { statusCode?: unknown; status?: unknown }
  const status = typeof value.statusCode === 'number' ? value.statusCode : value.status
  return status === 429 ? true : undefined
}

/** Only retry errors that indicate a transient provider failure. Validation,
 * authorization, and malformed-request errors must not silently change models. */
export function isTransientProviderFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { isRetryable?: unknown; statusCode?: unknown; status?: unknown }
  if (value.isRetryable === true) return true
  const status = typeof value.statusCode === 'number' ? value.statusCode : value.status
  return typeof status === 'number' && (status === 429 || (status >= 500 && status <= 599))
}

/**
 * Try the selected measured route, then its policy-ranked eligible fallbacks
 * on transient provider failures only. This does not alter routing policy or
 * fall back to unmeasured models. Explicit per-role operator overrides retain
 * their existing single-model behavior.
 */
export async function withMeasuredProviderFallback<T>(
  role: QuicksilverModelRole,
  invoke: (model: LanguageModel, selectedModelId: string) => Promise<T>,
): Promise<T> {
  const override = process.env[`QUICKSILVER_${role.toUpperCase()}_MODEL`]
  const historyPath = override ? undefined : process.env.QUICKSILVER_ROUTING_HISTORY_PATH?.trim() || undefined
  const baselineConfig = override ? null : readMeasuredRoutingConfig()
  if (historyPath && !baselineConfig) {
    throw new Error('QUICKSILVER_ROUTING_HISTORY_PATH requires QUICKSILVER_ROUTING_CONFIG; refusing unmeasured routing.')
  }
  let routingConfig: MeasuredRoutingConfig | null = baselineConfig
  if (historyPath && baselineConfig) {
    routingConfig = { ...baselineConfig, profiles: await loadModelRoutingProfiles(historyPath, baselineConfig.profiles) }
  }
  const route = override ? null : routeForRole(role, routingConfig)
  const modelIds = route?.selectedModelId
    ? [route.selectedModelId, ...route.fallbackModelIds]
    : [undefined]

  let lastError: unknown
  for (let index = 0; index < modelIds.length; index += 1) {
    const modelId = modelIds[index]
    const model = index === 0
      ? modelForRole(role, getMode(), routingConfig)
      : languageModelForId(modelId!, getMode())
    const actualModelId = modelId ?? resolveId(role, getMode())
    const startedAt = Date.now()
    let result: T
    try {
      result = await invoke(model, actualModelId)
    } catch (error) {
      lastError = error
      if (historyPath && baselineConfig) {
        const rateLimited = rateLimitedFailure(error)
        await appendModelRoutingOutcome(historyPath, baselineConfig.profiles, {
          modelId: actualModelId,
          taskType: ROLE_TASK[role],
          success: false,
          latencyMs: Math.max(0, Date.now() - startedAt),
          ...(rateLimited === undefined ? {} : { rateLimited }),
        })
      }
      if (!isTransientProviderFailure(error) || index === modelIds.length - 1) throw error
      continue
    }
    if (historyPath && baselineConfig) {
      await appendModelRoutingOutcome(historyPath, baselineConfig.profiles, {
        modelId: actualModelId,
        taskType: ROLE_TASK[role],
        success: true,
        latencyMs: Math.max(0, Date.now() - startedAt),
        rateLimited: false,
      })
    }
    return result
  }
  throw lastError
}
