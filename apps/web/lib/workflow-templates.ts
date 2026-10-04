import type { WorkflowGraph } from '../../../packages/kernel/src/workflows/graph.ts'

export interface WorkflowTemplate {
  id: string
  title: string
  /** One plain sentence on what the flow does, shown in the chooser. */
  summary: string
  /** Step kinds in reading order, shown as a short outline. */
  outline: string
  graph: WorkflowGraph
}

const query = { agentId: 'query', impact: 'low' as const, evaluationRequired: true }

/** Starter workflows. Every one passes validateWorkflowGraph and uses only read-only agent steps. */
export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'weekly-summary-review',
    title: 'Review a weekly business summary',
    summary: 'Summarize the week, then check the summary for anything unusual before it is returned.',
    outline: 'Trigger, 2 agents, output',
    graph: {
      schemaVersion: 1,
      id: 'weekly-summary-review',
      version: 1,
      entryNodeId: 'trigger-1',
      nodes: [
        { id: 'trigger-1', kind: 'trigger', label: 'Start the weekly review' },
        { id: 'agent-2', kind: 'agent', label: 'Summarize the week', config: { ...query } },
        { id: 'agent-3', kind: 'agent', label: 'Flag anything unusual', config: { ...query } },
        { id: 'output-4', kind: 'output', label: 'Return the reviewed summary' },
      ],
      edges: [
        { id: 'edge-1', from: 'trigger-1', to: 'agent-2' },
        { id: 'edge-2', from: 'agent-2', to: 'agent-3' },
        { id: 'edge-3', from: 'agent-3', to: 'output-4' },
      ],
    },
  },
  {
    id: 'metric-check-escalate',
    title: 'Check a metric and escalate',
    summary: 'Branch on whether a metric is off track. If it is, draft an escalation note; if not, finish quietly.',
    outline: 'Trigger, condition, agent, 2 outputs',
    graph: {
      schemaVersion: 1,
      id: 'metric-check-escalate',
      version: 1,
      entryNodeId: 'trigger-1',
      nodes: [
        { id: 'trigger-1', kind: 'trigger', label: 'Start the metric check' },
        { id: 'condition-2', kind: 'condition', label: 'Is the metric off track?', config: { conditionExpression: '$input.offTrack == true' } },
        { id: 'agent-3', kind: 'agent', label: 'Draft an escalation note', config: { ...query, impact: 'moderate' } },
        { id: 'output-4', kind: 'output', label: 'Return the escalation note' },
        { id: 'output-5', kind: 'output', label: 'No action needed' },
      ],
      edges: [
        { id: 'edge-1', from: 'trigger-1', to: 'condition-2' },
        { id: 'edge-2', from: 'condition-2', to: 'agent-3', branch: 'true' },
        { id: 'edge-3', from: 'condition-2', to: 'output-5', branch: 'false' },
        { id: 'edge-4', from: 'agent-3', to: 'output-4' },
      ],
    },
  },
  {
    id: 'research-then-propose',
    title: 'Research then propose',
    summary: 'Gather what is known about a question, then draft a proposal for a person to review.',
    outline: 'Trigger, 2 agents, output',
    graph: {
      schemaVersion: 1,
      id: 'research-then-propose',
      version: 1,
      entryNodeId: 'trigger-1',
      nodes: [
        { id: 'trigger-1', kind: 'trigger', label: 'Start with a question' },
        { id: 'agent-2', kind: 'agent', label: 'Research what is known', config: { ...query } },
        { id: 'agent-3', kind: 'agent', label: 'Draft a proposal', config: { ...query, impact: 'moderate' } },
        { id: 'output-4', kind: 'output', label: 'Return the proposal for review' },
      ],
      edges: [
        { id: 'edge-1', from: 'trigger-1', to: 'agent-2' },
        { id: 'edge-2', from: 'agent-2', to: 'agent-3' },
        { id: 'edge-3', from: 'agent-3', to: 'output-4' },
      ],
    },
  },
  {
    id: 'answer-with-quality-check',
    title: 'Answer with a quality check',
    summary: 'Answer a question. If the engine scores the answer below 70, take a second pass before returning it.',
    outline: 'Trigger, agent, condition, agent, 2 outputs',
    graph: {
      schemaVersion: 1,
      id: 'answer-with-quality-check',
      version: 1,
      entryNodeId: 'trigger-1',
      nodes: [
        { id: 'trigger-1', kind: 'trigger', label: 'Start with a question' },
        { id: 'agent-2', kind: 'agent', label: 'Answer the question', config: { ...query } },
        { id: 'condition-3', kind: 'condition', label: 'Is the answer well supported?', config: { conditionExpression: '$nqc.agent-2.reasoningScore >= 70' } },
        { id: 'agent-4', kind: 'agent', label: 'Take a second pass', config: { ...query } },
        { id: 'output-5', kind: 'output', label: 'Return the answer' },
        { id: 'output-6', kind: 'output', label: 'Return the second-pass answer' },
      ],
      edges: [
        { id: 'edge-1', from: 'trigger-1', to: 'agent-2' },
        { id: 'edge-2', from: 'agent-2', to: 'condition-3' },
        { id: 'edge-3', from: 'condition-3', to: 'output-5', branch: 'true' },
        { id: 'edge-4', from: 'condition-3', to: 'agent-4', branch: 'false' },
        { id: 'edge-5', from: 'agent-4', to: 'output-6' },
      ],
    },
  },
]

/** A fresh copy of a template's graph, so editing the draft never changes the template. */
export function templateGraph(id: string): WorkflowGraph | null {
  const template = WORKFLOW_TEMPLATES.find((item) => item.id === id)
  return template ? structuredClone(template.graph) : null
}
