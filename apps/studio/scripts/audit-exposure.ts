/**
 * Read-only audit of a dataset before it is made public. Prints counts only: which document types exist,
 * where personal identifiers, credential-shaped strings or free text typed by people appear, and when the
 * records people create were made. It never prints a value, so the output can be shared.
 *
 *   npm run audit:exposure
 *
 * Needs NEXT_PUBLIC_SANITY_PROJECT_ID, NEXT_PUBLIC_SANITY_DATASET and a Viewer token (SANITY_READ_TOKEN),
 * entered in your own shell. It reads; it never writes. Exit code 2 means something needs a person's review.
 */
import { auditDocuments, needsReview } from '../lib/exposure-audit.ts'
import { requireStudioSanityClient } from '../lib/sanity-client.ts'

const { client, config } = requireStudioSanityClient('read')

async function main(): Promise<void> {
  console.log(`Exposure audit (read only): ${config.projectId}/${config.dataset}\n`)

  const docs = await client.fetch<Record<string, unknown>[]>('*[!(_type match "system.*") && !(_type match "sanity.*")]', {}, { perspective: 'raw' })
  const report = auditDocuments(docs)

  console.log(`Documents scanned: ${report.documents}`)
  console.log('\nBy type:')
  for (const [type, count] of Object.entries(report.byType)) console.log(`  ${String(count).padStart(6)}  ${type}`)

  console.log('\nWhere people are named (distinct values, never printed):')
  if (!report.personFields.length) console.log('  none')
  for (const f of report.personFields) console.log(`  ${f.path}: ${f.distinct} distinct, ${f.emailLike} look like email addresses`)

  console.log('\nFree text typed into records people create (where real objectives and questions live):')
  if (!report.freeText.length) console.log('  none')
  for (const f of report.freeText) console.log(`  ${f.type}.${f.path}: ${f.documents} documents`)

  console.log('\nWhen people-created records were made:')
  if (!report.createdRange.length) console.log('  none')
  for (const r of report.createdRange) console.log(`  ${r.type}: ${r.first.slice(0, 10)} to ${r.last.slice(0, 10)}`)

  console.log('\nFindings (kind, where, how many; values are never shown):')
  if (!report.findings.length) console.log('  none')
  for (const f of report.findings) console.log(`  ${f.kind.padEnd(16)} ${f.type}.${f.path}  x${f.count}`)

  if (needsReview(report)) {
    console.log('\nREVIEW NEEDED: the findings above should be looked at by a person before this dataset is made public.')
    process.exit(2)
  }
  console.log('\nNothing flagged. That is not a guarantee: the free-text fields above are typed by people, so read a few before you publish.')
}

main().catch((error) => {
  // Name the failure, never a response body: it could contain a document.
  console.error(`Audit failed: ${error instanceof Error ? error.name : 'UnknownError'}. Check the project id, dataset and that SANITY_READ_TOKEN is a Viewer token.`)
  process.exit(1)
})
