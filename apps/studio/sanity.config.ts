import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { visionTool } from '@sanity/vision'
import { workflow } from 'sanity-plugin-workflow'
import { schemaTypes } from './schemas/index.ts'
import { dedicatedSanityProjectId } from './lib/sanity-project-id.ts'

/**
 * Sanity Workflows (the actual product feature, not our own `workflow`
 * document type or the kernel's status machine) -- a Studio-side curation
 * layer for human reviewers triaging `decision` documents.
 *
 * This is purely additive: it tracks its own metadata document per
 * `decision`, separate from the `status` field the kernel and /api routes
 * already drive. Nothing in the running app reads or writes these states --
 * they exist so a human reviewer can open Studio, see every
 * awaiting-approval decision on one kanban board, and drag it through
 * Approved/Rejected/Executed as a lightweight editorial view alongside the
 * app's own approve/reject buttons. Path Two bonus feature.
 */
const decisionWorkflow = workflow({
  schemaTypes: ['decision'],
  states: [
    {
      id: 'awaitingApproval',
      title: 'Awaiting Approval',
      color: 'warning',
      transitions: ['approved', 'rejected'],
    },
    {
      id: 'approved',
      title: 'Approved',
      color: 'primary',
      transitions: ['executed'],
    },
    {
      id: 'rejected',
      title: 'Rejected',
      color: 'danger',
      transitions: [],
    },
    {
      id: 'executed',
      title: 'Executed',
      color: 'success',
      transitions: [],
    },
  ],
})

/**
 * Vision, Sanity's GROQ playground, against the dataset Studio is pointed at.
 *
 * This entry is *Ship an Agent That Queries Real Content*, so the queries are the
 * interesting part and they are otherwise invisible: every one of them lives in an
 * API route or a store module. Vision lets a reader run the real GROQ, change it, and
 * then watch the app answer differently.
 *
 * It adds no privilege. GROQ queries are read-only, it runs as whoever can already
 * open Studio, and that person can already edit every document. Keeping it on in the
 * deployed Studio is deliberate: the audience for this is a judge.
 *
 * Pinned to the 5.x line deliberately. @sanity/vision 6.x peers on sanity ^6; this repo
 * is on sanity 5, and moving the Studio to 6 is its own piece of work.
 */
const vision = visionTool()

export default defineConfig({
  name: 'nuera-quicksilver',
  title: 'Nuera Quicksilver',
  // The Vercel services deployment mounts Studio at /studio. Keep the
  // existing standalone Sanity Studio deployment at / unless overridden.
  basePath: process.env.SANITY_STUDIO_BASE_PATH || (process.env.VERCEL ? '/studio' : '/'),

  projectId: dedicatedSanityProjectId(),
  dataset: process.env.SANITY_STUDIO_DATASET || 'production',

  plugins: [structureTool(), decisionWorkflow, vision],

  schema: {
    types: schemaTypes,
  },
})
