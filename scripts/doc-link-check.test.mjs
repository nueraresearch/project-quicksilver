import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * A heading rename once broke a link from a decision record into the cutover
 * plan and nothing noticed. These pin the outcomes that matter: a clean tree
 * passes, a missing file or anchor fails, the whole tree is in scope, a tree
 * with nothing to check is neither a pass nor a failure, uncommitted drafts are
 * ignored, and this repository's own cross-references resolve.
 */
const SCRIPT = fileURLToPath(new URL('./doc-link-check.mjs', import.meta.url))

function withFixture(files, check) {
  const dir = mkdtempSync(join(tmpdir(), 'qs-doc-links-'))
  try {
    for (const [path, body] of Object.entries(files)) {
      const full = join(dir, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, body)
    }
    check(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const run = (dir) => spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' })

test('resolvable file, heading, explicit-id, root-relative and same-file references pass', () => {
  withFixture(
    {
      'docs/a.md': [
        '# Alpha',
        '',
        '[file](b.md) · [heading](b.md#beta-section) · [id](b.md#explicit) · [self](#alpha)',
        '[rooted](/docs/b.md#beta-section) · [code](../scripts/x.mjs)',
        '[web](https://example.com/unchecked)',
        '',
      ].join('\n'),
      'docs/b.md': '# Beta\n\n## Beta section\n\n<a id="explicit"></a>text\n',
      'scripts/x.mjs': 'export {}\n',
    },
    (dir) => {
      const result = run(dir)
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
      assert.match(result.stdout, /6 link\(s\), 0 broken/, 'six relative links are checked; the external one is not')
    },
  )
})

test('a link to a missing file fails and names the reference', () => {
  withFixture({ 'docs/a.md': '# Alpha\n\n[gone](missing.md)\n' }, (dir) => {
    const result = run(dir)
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
    assert.match(result.stdout, /docs\/a\.md:3 -> missing\.md \(file does not exist\)/, 'the failure must name the source line and target')
  })
})

test('a link to a missing heading or id fails', () => {
  withFixture(
    {
      'docs/a.md': '# Alpha\n\n[bad](b.md#renamed-away)\n',
      'docs/b.md': '# Beta\n\n## Beta section\n',
    },
    (dir) => {
      const result = run(dir)
      assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
      assert.match(result.stdout, /b\.md#renamed-away \(no heading or id with that anchor\)/, 'a renamed heading must be reported as such')
    },
  )
})

test('a tree with no markdown files exits 2 rather than passing over nothing', () => {
  withFixture({ 'docs/.keep': '' }, (dir) => {
    const result = run(dir)
    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`)
    assert.match(result.stderr, /no markdown files found/, 'the outcome must say what was missing')
  })
})

test('a markdown tree with no cross-references exits 2', () => {
  withFixture({ 'docs/a.md': '# Alpha\n\nNo links here.\n' }, (dir) => {
    const result = run(dir)
    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`)
    assert.match(result.stderr, /no cross-references found/)
  })
})

test('root and package markdown are checked, not only docs/', () => {
  withFixture(
    {
      'README.md': '# Root\n\n[alpha](docs/a.md#alpha)\n',
      'docs/a.md': '# Alpha\n',
      'packages/p/README.md': '# P\n\n[gone](docs/nope.md)\n',
    },
    (dir) => {
      const result = run(dir)
      assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
      assert.match(result.stdout, /doc links: 3 file\(s\), 2 link\(s\), 1 broken/)
      assert.match(result.stdout, /packages\/p\/README\.md:3 -> docs\/nope\.md \(file does not exist\)/, 'a package README that links into docs/ must be checked from its own directory')
    },
  )
})

test('a # line or anchor id inside a fenced block is not an anchor', () => {
  withFixture(
    {
      'docs/a.md': [
        '# Alpha',
        '',
        '[fenced heading](b.md#fenced-heading)',
        '[fenced id](b.md#fenced-id)',
        '[tilde heading](b.md#tilde-heading)',
        '[real before](b.md#beta)',
        '[real after](b.md#after)',
        '',
      ].join('\n'),
      'docs/b.md': [
        '# Beta',
        '',
        '```',
        '## fenced heading',
        '<a id="fenced-id"></a>',
        '```',
        '',
        '~~~',
        '## tilde heading',
        '~~~',
        '',
        '## After',
        '',
      ].join('\n'),
    },
    (dir) => {
      const result = run(dir)
      assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
      assert.match(result.stdout, /5 link\(s\), 3 broken/)
      for (const anchor of ['fenced-heading', 'fenced-id', 'tilde-heading']) {
        assert.match(result.stdout, new RegExp(`b\\.md#${anchor} \\(no heading or id with that anchor\\)`), `${anchor} is inside a fence and must not resolve`)
      }
      assert.doesNotMatch(result.stdout, /b\.md#beta|b\.md#after/, 'headings outside a fence must still resolve')
    },
  )
})

test('a link inside a fenced block is not a reference', () => {
  withFixture(
    {
      'docs/a.md': [
        '# Alpha',
        '',
        '[outside](b.md)',
        '',
        '```',
        '[sample](not-here.md)',
        '```',
        '',
        '~~~',
        '[also a sample](nor-here.md)',
        '~~~',
        '',
      ].join('\n'),
      'docs/b.md': '# Beta\n',
    },
    (dir) => {
      const result = run(dir)
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
      assert.match(result.stdout, /2 file\(s\), 1 link\(s\), 0 broken/, 'only the link outside the fences is a reference')
    },
  )
})

test('an inline code span is neither a link nor an anchor', () => {
  withFixture(
    {
      'docs/a.md': [
        '# Alpha',
        '',
        '`[sample](not-here.md)`',
        '',
        '[real](b.md#beta)',
        '[code anchor](b.md#not-an-anchor)',
        '[heading code](b.md#the-beta-heading)',
        '',
      ].join('\n'),
      'docs/b.md': ['# Beta', '', '## The `beta` heading', '', '`# not an anchor`', ''].join('\n'),
    },
    (dir) => {
      const result = run(dir)
      assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
      assert.match(result.stdout, /3 link\(s\), 1 broken/, 'the sample link is not counted; the three prose links are')
      assert.match(result.stdout, /b\.md#not-an-anchor \(no heading or id with that anchor\)/, 'a heading inside a code span is not an anchor')
      assert.doesNotMatch(result.stdout, /not-here\.md/, 'the link inside the code span must not be scanned')
      assert.doesNotMatch(result.stdout, /b\.md#(beta|the-beta-heading)/, 'code inside a heading still counts towards its slug')
    },
  )
})

test('an HTML comment is neither a link nor an anchor', () => {
  withFixture(
    {
      'docs/a.md': [
        '# Alpha',
        '',
        '<!-- [hidden](not-here.md) -->',
        '',
        '<!--',
        '[multi-line](also-not-here.md)',
        '# not-a-heading',
        '-->',
        '',
        '[commented anchor](#not-a-heading)',
        '[real](b.md)',
        '',
      ].join('\n'),
      'docs/b.md': '# Beta\n',
    },
    (dir) => {
      const result = run(dir)
      assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
      assert.match(result.stdout, /2 link\(s\), 1 broken/, 'links in comments are not counted; the two outside are')
      assert.match(result.stdout, /a\.md:10 -> #not-a-heading \(no heading or id with that anchor\)/, 'a heading inside a comment is not an anchor')
      assert.doesNotMatch(result.stdout, /not-here\.md/, 'links inside comments must not be scanned')
    },
  )
})

test('an unmatched backtick is literal text, not code to end of line', () => {
  withFixture(
    {
      'docs/a.md': ['# Alpha', '', 'an `unmatched tick [after](b.md)', 'a ` stray [gone](missing.md)', ''].join('\n'),
      'docs/b.md': '# Beta\n',
    },
    (dir) => {
      const result = run(dir)
      assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
      assert.match(result.stdout, /2 link\(s\), 1 broken/, 'resolution still sees the links after the stray backticks')
      assert.match(result.stdout, /a\.md:4 -> missing\.md \(file does not exist\)/, 'the link after an unmatched backtick is still read')
      assert.doesNotMatch(result.stdout, /-> b\.md/, 'the resolvable link after an unmatched backtick is read and resolves')
    },
  )
})

// Fixtures prove the checker works. This proves the repository is clean, which
// is the only reason the check is in the suite: without it, `npm run verify`
// runs a well-tested tool that never looks at the documents it protects.
test("this repository's own cross-references resolve", () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
  assert.equal(result.status, 0, `the check failed against this repository:\n${result.stdout}${result.stderr}`)
})

// A draft in someone's working tree is not a repository fact. If it could fail
// the suite, the check would be reporting on uncommitted work in progress.
test('untracked markdown is out of scope, tracked markdown is not', () => {
  withFixture(
    {
      'README.md': '# Root\n\n[alpha](docs/a.md#alpha)\n',
      'docs/a.md': '# Alpha\n',
      'draft.md': '# Draft\n\n[gone](docs/not-committed.md)\n',
    },
    (dir) => {
      const init = spawnSync('git', ['init', '-q'], { cwd: dir })
      assert.equal(init.status, 0, 'this case needs git to tell tracked from untracked')
      spawnSync('git', ['add', 'README.md', 'docs/a.md'], { cwd: dir })
      const result = run(dir)
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
      assert.match(result.stdout, /doc links: 2 file\(s\), 1 link\(s\), 0 broken/, 'the untracked draft must not be scanned')
    },
  )
})
