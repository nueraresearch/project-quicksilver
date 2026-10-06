import type { WorkflowGraph } from '../workflows/graph.ts'
import type { Principal } from '../identity/rbac.ts'
import { WorkflowRunQueue, type EnqueueResult } from '../runtime/queue.ts'

export type MetricOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'

export interface BusinessEventTriggerDefinition {
  id: string
  tenantId: string
  eventType: string
  graph: WorkflowGraph
  principal?: Principal
  enabled?: boolean
}

export interface BusinessMetricTriggerDefinition {
  id: string
  tenantId: string
  metric: string
  operator: MetricOperator
  threshold: number
  graph: WorkflowGraph
  principal?: Principal
  enabled?: boolean
}

export type BusinessTriggerDefinition = BusinessEventTriggerDefinition | BusinessMetricTriggerDefinition

export interface BusinessEvent {
  tenantId: string
  eventType: string
  eventId: string
  payload: unknown
  at?: number
}

export interface BusinessMetricSample {
  tenantId: string
  metric: string
  value: number
  sampleId: string
  at?: number
}

export interface BusinessTriggerDelivery {
  triggerId: string
  result: EnqueueResult
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const EVENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const METRIC = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function validDefinition(definition: BusinessTriggerDefinition): void {
  if (!definition || !ID.test(definition.id)) throw new Error('Business trigger id is invalid.')
  if (!ID.test(definition.tenantId)) throw new Error('Business trigger tenantId is invalid.')
  if (definition.enabled !== undefined && typeof definition.enabled !== 'boolean') throw new Error('Business trigger enabled must be boolean.')
  if ('eventType' in definition) {
    if (!EVENT_TYPE.test(definition.eventType)) throw new Error('Business eventType is invalid.')
  } else {
    if (!METRIC.test(definition.metric)) throw new Error('Business metric name is invalid.')
    if (!['gt', 'gte', 'lt', 'lte', 'eq', 'neq'].includes(definition.operator)) throw new Error('Business metric operator is invalid.')
    if (!Number.isFinite(definition.threshold)) throw new Error('Business metric threshold must be finite.')
  }
}

function metricMatches(operator: MetricOperator, value: number, threshold: number): boolean {
  switch (operator) {
    case 'gt': return value > threshold
    case 'gte': return value >= threshold
    case 'lt': return value < threshold
    case 'lte': return value <= threshold
    case 'eq': return value === threshold
    case 'neq': return value !== threshold
  }
}

/**
 * Routes governed business events and metric samples into the durable run queue.
 * The queue remains the authority for tenant scope, RBAC, graph validation,
 * idempotency and backpressure; this class only decides which definitions match.
 */
export class BusinessTriggerRegistry {
  private readonly definitions = new Map<string, BusinessTriggerDefinition>()

  constructor(private readonly queue: WorkflowRunQueue) {}

  add(definition: BusinessTriggerDefinition): void {
    validDefinition(definition)
    if (this.definitions.has(definition.id)) throw new Error(`Business trigger "${definition.id}" already exists.`)
    this.definitions.set(definition.id, structuredClone(definition))
  }

  remove(id: string): boolean { return this.definitions.delete(id) }

  setEnabled(id: string, enabled: boolean): boolean {
    const definition = this.definitions.get(id)
    if (!definition) return false
    definition.enabled = enabled
    return true
  }

  list(): BusinessTriggerDefinition[] { return [...this.definitions.values()].map((definition) => structuredClone(definition)) }

  async emitEvent(event: BusinessEvent): Promise<BusinessTriggerDelivery[]> {
    if (!ID.test(event.tenantId) || !EVENT_TYPE.test(event.eventType) || !ID.test(event.eventId)) throw new Error('Business event identity is invalid.')
    const deliveries: BusinessTriggerDelivery[] = []
    for (const definition of this.definitions.values()) {
      if (definition.enabled === false || !('eventType' in definition) || definition.tenantId !== event.tenantId || definition.eventType !== event.eventType) continue
      deliveries.push({ triggerId: definition.id, result: await this.queue.enqueue({
        graph: definition.graph,
        input: { event: structuredClone(event.payload), eventType: event.eventType, eventId: event.eventId, occurredAt: event.at ?? Date.now() },
        tenantId: event.tenantId,
        trigger: { kind: 'event', source: definition.id },
        idempotencyKey: `business:event:${definition.id}:${event.eventId}`,
        principal: definition.principal,
      }) })
    }
    return deliveries
  }

  async observeMetric(sample: BusinessMetricSample): Promise<BusinessTriggerDelivery[]> {
    if (!ID.test(sample.tenantId) || !METRIC.test(sample.metric) || !ID.test(sample.sampleId) || !Number.isFinite(sample.value)) throw new Error('Business metric sample is invalid.')
    const deliveries: BusinessTriggerDelivery[] = []
    for (const definition of this.definitions.values()) {
      if (definition.enabled === false || !('metric' in definition) || definition.tenantId !== sample.tenantId || definition.metric !== sample.metric || !metricMatches(definition.operator, sample.value, definition.threshold)) continue
      deliveries.push({ triggerId: definition.id, result: await this.queue.enqueue({
        graph: definition.graph,
        input: { metric: sample.metric, value: sample.value, sampleId: sample.sampleId, measuredAt: sample.at ?? Date.now(), operator: definition.operator, threshold: definition.threshold },
        tenantId: sample.tenantId,
        trigger: { kind: 'event', source: definition.id },
        idempotencyKey: `business:metric:${definition.id}:${sample.sampleId}`,
        principal: definition.principal,
      }) })
    }
    return deliveries
  }
}
