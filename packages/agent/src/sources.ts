import type { EvaluatorToolCall } from '@quicksilver/kernel'

export type SourceKind = 'knowledge-base' | 'dataset-query' | 'schema' | 'app' | 'other'

export interface AnswerSource {
  kind: SourceKind
  /** The tool that ran, as named by the endpoint or the app. */
  tool: string
  label: string
  /** What the call asked for (a GROQ query, an entry id), when the call recorded it. */
  detail?: string
  succeeded: boolean
}

const APP_LABELS: Record<string, string> = {
  get_my_access: 'Your access', list_decisions: 'Decisions', get_decision: 'A decision', get_business_overview: 'The overview',
  get_finance_summary: 'The money ledger', get_workflow_activity: 'Workflow activity', get_trace_summary: 'Traces',
  list_agent_catalog: 'The agent catalog', list_company_entities: 'Company records', list_workflow_versions: 'Workflow versions',
  get_workflow_runs: 'Workflow runs', get_attention: 'What needs you',
}

/**
 * Turns the tool calls behind an answer into the list shown under it: which Sanity Context endpoint was
 * used (the knowledge base or a live dataset query) and which of the app's own pages were read. This
 * is what lets a person check that an answer came from records, not from the model's memory.
 */
export function describeSources(calls: readonly EvaluatorToolCall[], appToolNames: readonly string[] = Object.keys(APP_LABELS)): AnswerSource[] {
  const seen = new Set<string>()
  const out: AnswerSource[] = []
  for (const call of calls) {
    const name = call.name
    const base = name.replace(/^(kb|groq)_/, '')
    let source: Omit<AnswerSource, 'succeeded' | 'detail'>
    if (appToolNames.includes(name)) source = { kind: 'app', tool: name, label: APP_LABELS[name] ?? name }
    else if (base === 'initial_context') source = { kind: 'schema', tool: name, label: 'Endpoint instructions' }
    else if (base === 'knowledge_base_read' || base === 'knowledge_base_search' || name.startsWith('kb_') || base.startsWith('knowledge_base')) source = { kind: 'knowledge-base', tool: name, label: 'Knowledge base entry' }
    else if (name === 'groq_query' || (name.startsWith('groq_') && base === 'query')) source = { kind: 'dataset-query', tool: name, label: 'Company dataset query' }
    else if (base === 'schema_explorer') source = { kind: 'schema', tool: name, label: 'Company data schema' }
    else source = { kind: 'other', tool: name, label: 'Company data' }
    const key = `${source.tool}\u0000${call.detail ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...source, ...(call.detail ? { detail: call.detail } : {}), succeeded: call.succeeded })
  }
  return out.slice(0, 20)
}
