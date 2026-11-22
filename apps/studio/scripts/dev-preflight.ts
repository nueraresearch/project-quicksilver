/**
 * Why this exists: `npm run dev` at the repository root is the zero-config path
 * and does not include Studio. Studio is the optional Sanity-backed admin
 * surface and needs the dedicated project; without it `sanity dev` fails inside
 * the Sanity CLI loader with "CLI config cannot be loaded", which says nothing
 * about what to do next or that a zero-config path exists.
 *
 * This prints the two ways forward and exits 1 before the Sanity CLI starts.
 * The studio package compiles scripts as CommonJS, so there is no top-level
 * await here; the work sits inside main().
 */
import { dedicatedSanityProjectId } from '../lib/sanity-project-id.ts'

function main(): void {
  try {
    dedicatedSanityProjectId()
  } catch {
    process.stderr.write(
      [
        'Studio needs the dedicated Sanity project; it is the optional admin surface, not the console.',
        '',
        '  Zero-config console:   npm run dev          (no accounts, no credentials)',
        '  Configured Studio:     set SANITY_STUDIO_PROJECT_ID, then npm run dev:studio',
        '',
        'The dedicated project is f87t11g1; see docs/platform/sanity-isolation.md.',
        'The withdrawn challenge project is refused by design.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
}

main()
