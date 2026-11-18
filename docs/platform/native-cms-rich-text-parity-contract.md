# Native CMS rich-text and Portable Text parity contract (draft)

- **Status:** Design-only contract. No schema, renderer, sanitizer, editor, route, migration, fixture, or runtime code is implemented by this document.
- **Date:** 2026-11-17
- **Scope:** Any native CMS field explicitly designated as rich text, including migrated Sanity Portable Text and future native-authored rich text. It applies to content, admin preview, public rendering, search/context extraction, and migration round trips.
- **Current baseline:** The 36 registered Sanity schemas contain **no `type: 'block'` or `blockContent` field**. Rich-adjacent fields such as `draftedCommunication.body`, `decision.reasoningSummary`, `evidence.claim`, and `review.summary` are plain `text` today. This contract does **not** reclassify them. A field becomes rich text only through an owner-approved C0 field-mapping decision.
- **Hard rule:** Plain text is never silently parsed as Portable Text, Markdown, or HTML. Unknown rich-text nodes are preserved and quarantined, never dropped or rendered as raw HTML.

## 1. What parity means

Parity has four separate claims. Passing one does not prove another.

| Claim | Meaning | Evidence |
|---|---|---|
| **Semantic preservation** | Every supported node, mark, annotation, reference, and unknown field survives import/export without silent loss. | Canonical round-trip digests. |
| **Rendering parity** | Supported nodes render deterministically with the same meaning and structure as the source. | Golden render trees/HTML. |
| **Safety** | No raw HTML, unsafe URL, cross-tenant reference, or external asset URL executes or leaks. | Negative security fixtures. |
| **Publishability** | A document with unresolved, unknown, or invalid rich content cannot become public. | Publish gate and diagnostics. |

The contract is about the rich-text document, not the surrounding content record. It does not replace the C1 50-case repository gate or the C5 real-export gate.

## 2. Canonical document model

A native rich-text document is an ordered array of blocks. Arrays preserve order. Every block, span, and inline object has a stable `_key`; keys are never regenerated during a round trip.

```text
RichTextDocument = RichTextBlock[]
RichTextBlock    = Block | InlineObject | UnknownPreservation
RichTextChild    = Span | InlineObject | UnknownPreservation
Block            = { _type: "block", _key, style?, listItem?, level?, children, markDefs, unknownFields? }
Span             = { _type: "span", _key, text, marks, unknownFields? }
InlineObject     = Image | File | RegisteredObject
UnknownPreservation = { _type: "unknown", _key, unknownId, nodeType, digest, disposition }
```

An inline object may appear as a block-level array member or inside a block's `children`. The renderer chooses the block-level or inline treatment from the object type and its position; it does not flatten one into the other.

The active native payload must not contain a Sanity `_ref`, a Sanity CDN URL, or a client-supplied tenant. Known references become native target IDs. Unknown reference-bearing nodes are quarantined; their raw source stays in the private migration archive, not the active payload.

### 2.1 Canonicalization and digest

Canonical JSON is required for round-trip equality:

- object keys are sorted recursively;
- arrays preserve order, including blocks, spans, `markDefs`, and references;
- text is preserved exactly, with no Unicode normalization, case folding, or whitespace rewriting;
- `_key` values are preserved exactly and never regenerated;
- numbers remain JSON numbers, not strings;
- line endings follow the import contract; if normalized, the rule is recorded in the mapping;
- the document digest is SHA-256 over the UTF-8 canonical JSON.

The private unknown-node archive uses the same canonicalization. The known-document digest and the unknown-archive digest are separate evidence values.

## 3. Supported nodes

### 3.1 Block

| Variant | Supported values | Render rule |
|---|---|---|
| Style | `normal`, `h1`, `h2`, `h3`, `h4`, `blockquote` | `normal` → paragraph; headings → matching heading element; `blockquote` → blockquote containing a paragraph. Absent style means `normal`. |
| List item | `bullet`, `number` | Group consecutive items by type and level; render `ul`/`ol`; nested levels render nested lists. |
| Level | Integer `1`–`6` | Required when `listItem` is present; otherwise absent or ignored. |
| Children | Ordered spans | A block with non-span children is invalid for publish unless the child is a supported image, file, or registered object. An unknown child is preserved as quarantined and blocks publish; it is never dropped or silently treated as a span. |
| `markDefs` | Ordered annotation definitions | Preserve order and keys; unknown annotation types block publish. |
| Unknown fields | Any JSON value | Preserve under `unknownFields`; do not render. |

### 3.2 Span and marks

| Mark | Type | Rule |
|---|---|---|
| `strong` | Decorator | Render `<strong>`; preserve overlapping spans. |
| `em` | Decorator | Render `<em>`. |
| `code` | Decorator | Render `<code>`; text is escaped; no inline HTML. |
| `underline` | Decorator | Render `<u>`. |
| `strike-through` | Decorator | Render `<s>`. |
| `link` | Annotation | External URL; sanitize and render `<a>`. |
| `internalLink` | Annotation | Native target; resolve within the principal tenant. |
| Unknown decorator or annotation | Any other value | Preserve; block publish; render plain text or a safe placeholder in admin preview. |

`text` is a string and is the only content of a span. Empty spans are preserved but render nothing. Newlines inside `text` remain text and do not become `<br>` in the canonical HTML serialization. Inline HTML in `text` is escaped literally.

### 3.3 Link annotation

| Field | Rule |
|---|---|
| `_type` | `link` |
| `_key` | Required, stable |
| `href` | Required; trimmed; length ≤ 2,048; allowlist `https:`, `http:`, `mailto:`, `tel:`; no credentials, `javascript:`, `data:`, `vbscript:`, `file:`, protocol-relative URL, or control-character obfuscation. |
| `title` | Optional plain text; attribute-escaped |
| `openInNewTab` | Optional boolean; when true, render `target="_blank"` and `rel="noopener noreferrer"` |

Invalid `href` is a validation error. It blocks publish and renders as plain text, not as a link.

### 3.4 Internal link annotation

| Field | Rule |
|---|---|
| `_type` | `internalLink` |
| `_key` | Required, stable |
| `targetId` | Native target ID, never a Sanity `_ref` |
| `targetType` | One retained content type; OIDC/auth types and assets are not content-link targets |
| `weak` | Optional boolean; preserves weak-reference semantics |

A strong internal link must resolve to a live, non-tombstoned record in the principal's tenant before publish. A missing, foreign, tombstoned, purged, or wrong-type target blocks publish. At render, it becomes plain text with no `href` and a diagnostic. A weak internal link may remain unresolved without blocking publish; it renders as plain text and records a diagnostic. A foreign target always blocks, even when weak.

### 3.5 Image

| Field | Rule |
|---|---|
| `_type` | `image` |
| `_key` | Required, stable |
| `assetId` | Native asset ID; no Sanity `_ref`, CDN URL, or arbitrary external image URL |
| `alt` | Plain text; required, may be empty only when `decorative: true` |
| `caption` | Optional plain text; no nested rich text in this contract |
| `hotspot`, `crop` | Optional presentation metadata; validated by the asset policy |
| `decorative` | Optional boolean |

Missing, foreign, tombstoned, or purged assets block publish. At render, the image uses the native asset delivery path, not a stored URL. A missing asset renders a safe placeholder with the alt text and a diagnostic.

### 3.6 File

| Field | Rule |
|---|---|
| `_type` | `file` |
| `_key` | Required, stable |
| `assetId` | Native asset ID |
| `title` | Optional plain text |
| `mimeType` | Optional validated type |

Missing or foreign assets block publish. The render is a link to the native delivery path with a safe label; no raw storage key.

### 3.7 Registered objects

Additional inline objects, such as a code block or callout, are **not implicitly supported**. Each requires an owner-approved registration that names the node type, fields, render tree, sanitization behavior, and round-trip fixtures. Until registered, the object is an unknown node and blocks publish.

## 4. References and assets

### 4.1 Reference resolution

Every rich-text reference is resolved in this order:

1. principal tenant from the authenticated request;
2. `targetId` within that tenant;
3. target type is allowed for rich text;
4. target is active and not tombstoned or purged;
5. target is visible to the caller.

No request body, query parameter, environment variable, default tenant, display name, slug, or source `_ref` substitutes for the principal tenant. A foreign target produces no target body and no existence detail.

### 4.2 Source reference normalization

- Known Sanity references are migrated to native `targetId` and `targetType`.
- A known asset reference becomes a native `assetId` under the asset policy.
- A rich-text payload never stores a Sanity `_ref` or CDN URL.
- An unresolved source reference is not guessed. The containing node is quarantined, its raw source stays in the private migration archive, and the document cannot publish.
- Unknown fields that contain a `_ref` follow the same rule: preserve, quarantine, and block publish. They do not enter the active payload as source references.

### 4.3 Link and asset failures

| Condition | Publish | Render |
|---|---|---|
| Strong internal link resolves | Allowed | Link |
| Weak internal link unresolved | Allowed with diagnostic | Plain text, no link |
| Strong internal link missing/foreign/tombstoned/purged | Blocked | Plain text, no foreign detail |
| External URL valid | Allowed | Sanitized link |
| External URL invalid scheme/credentials | Blocked | Plain text, no link |
| Image/file asset resolves | Allowed | Native delivery |
| Image/file missing, foreign, tombstoned, or purged | Blocked | Safe placeholder / alt text |
| Unknown reference-bearing node | Blocked | Safe placeholder only |

## 5. Unknown-node preservation

Unknown content is never silently dropped, coerced, or rendered as HTML. The preservation model has three levels:

| Level | Example | Active payload | Publish |
|---|---|---|---|
| **Preserved field** | Extra field on a known block/span/link | Stored under `unknownFields`; not rendered | Allowed if it does not change semantics |
| **Quarantined node** | Unknown block style, decorator, annotation type, inline object, or node type | Stored as `unknown` envelope with `unknownId`, `nodeType`, and `digest`; canonical node in private archive | Blocked |
| **Quarantined reference** | Unknown node or field containing a source `_ref` | Envelope only; no source `_ref` in active payload; raw source private | Blocked |

### 5.1 Preservation envelope

The active payload may contain:

```text
{
  _type: "unknown",
  _key: "<stable key>",
  unknownId: "<opaque id>",
  nodeType: "<source _type or mark/style name>",
  digest: "<sha256 of canonical source node>",
  disposition: "quarantined"
}
```

The exact source node is stored in the private preservation archive under `unknownId`. The archive is evidence, not a rendering source. A public response must not expose the archive path, raw source, `_ref`, filename, or payload.

### 5.2 Unknown semantics

- Unknown **fields** on a known node do not block publish because they do not change rendering. They survive round trips and are excluded from public projections until promoted.
- Unknown **style, list type, decorator, annotation type, or inline object** blocks publish because the meaning cannot be rendered faithfully.
- Unknown **reference** blocks publish and cannot be normalized automatically.
- A node with duplicate `_key`, missing `_key`, invalid span children, a mark referencing a missing mark definition, or a list item without a valid level is invalid and blocks publish.
- A quarantined node is visible in admin preview only as a safe placeholder with its `unknownId`; public rendering fails closed.

Unknown-node classification is an owner-approved mapping decision. It is not inferred from the node name, rendered appearance, or a best-effort HTML conversion.

## 6. Rendering contract

### 6.1 Render model

Rendering is a pure function of:

- the canonical rich-text document;
- the principal tenant;
- resolved native references and assets;
- the registered node renderers.

The canonical output is a typed render tree. HTML is a serialization of that tree. Text and email variants are separate serializations of the same tree.

### 6.2 Deterministic mapping

| Input | Output |
|---|---|
| `normal` block | `<p>` |
| `h1`–`h4` | `<h1>`–`<h4>` |
| `blockquote` | `<blockquote><p>…</p></blockquote>` |
| bullet/number list | `<ul>`/`<ol>` with nested lists by level |
| `strong`, `em`, `code`, `underline`, `strike-through` | Matching semantic element; text escaped |
| external link | `<a href="…">` with sanitized URL |
| internal link | `<a href="…">` only after tenant-scoped resolution |
| image | `<figure><img …><figcaption>…</figcaption></figure>` when caption exists |
| file | `<a>` to native delivery with safe label |
| unknown/quarantined | Safe placeholder in admin only; public render refuses |

The renderer must not:

- use `dangerouslySetInnerHTML`, `innerHTML`, or an equivalent raw-HTML injection;
- accept renderer HTML from the document;
- emit `style`, `class`, `id`, event handlers, or arbitrary `data-*` attributes from content;
- render a foreign, missing, tombstoned, or purged reference as a live link or image;
- turn a sanitization failure into a silently stripped field without a diagnostic.

### 6.3 Whitespace and text

- Text is escaped exactly; no HTML entity injection.
- Unicode, RTL text, emoji, combining marks, and zero-width characters are preserved. Null and unsafe control characters are rejected or replaced with a documented diagnostic.
- Consecutive spaces and newlines inside a span remain text. The visual treatment is a renderer concern; the document is not rewritten.
- Empty blocks and empty spans are preserved but may render no visible content.

### 6.4 Preview versus public

Admin preview may show safe placeholders for unknown nodes and unresolved references. Public rendering returns a refusal or an empty rich-text result with a diagnostic; it never exposes the placeholder's internal archive data.

## 7. Sanitization contract

### 7.1 Input

- Reject raw HTML nodes; do not parse HTML into rich text.
- Reject `_type` values that are not registered or explicitly unknown.
- Reject duplicate `_key` values, missing keys, invalid child types, invalid levels, and missing mark definitions.
- Reject source `_ref`, Sanity CDN URLs, external image URLs, and storage keys in active rich text.
- Normalize only documented values: trim link URLs; normalize line endings if the import contract says so; never normalize text content silently.

### 7.2 URLs

Allowlist schemes: `https:`, `http:`, `mailto:`, `tel:`.

Reject:

- `javascript:`, `data:`, `vbscript:`, `file:`, and unknown schemes;
- protocol-relative URLs;
- embedded credentials;
- control characters, whitespace-obfuscated schemes, and percent-encoded scheme tricks;
- URLs longer than 2,048 characters.

`openInNewTab` adds `rel="noopener noreferrer"`. The renderer never accepts a caller-supplied `target`, `rel`, or event attribute.

### 7.3 HTML serialization

If HTML is produced:

- text is escaped before insertion;
- attribute values are quoted and escaped;
- only renderer-controlled tags and attributes are emitted;
- no content-provided tag names, attribute names, or CSS;
- no raw SVG, iframe, object, embed, script, or style nodes;
- no remote image source; images use the native asset delivery path.

A sanitizer failure is a publish-blocking validation error and a render refusal, not a silent field deletion.

### 7.4 Email and other serializations

Email HTML uses the same render tree and sanitizer. It must not introduce remote images or tracking pixels unless a separate owner-approved delivery policy allows them. Plain-text email uses the text serialization, not a regex strip of HTML.

## 8. Round-trip fixtures

These are planned fixtures, not test code. The implementation must provide all of them; a missing fixture is a failed contract, not an untested edge.

| ID | Fixture | Expected |
|---|---|---|
| **RT-01** | Plain paragraphs, empty block, empty span, leading/trailing spaces | Canonical JSON and text round-trip; empty content preserved |
| **RT-02** | `normal`, `h1`–`h4`, `blockquote` | Exact block order, style, keys, spans, and render tree |
| **RT-03** | Bullet and numbered lists, levels 1–6, nested mixed lists | Stable list grouping and nesting; no reordering |
| **RT-04** | Overlapping `strong`/`em`/`code`/`underline`/`strike-through` marks | Marks and span order preserved; semantic render |
| **RT-05** | Valid `https`, `http`, `mailto`, `tel`; invalid scheme, credentials, control-character URL | Valid links round-trip; invalid links block publish and render as text |
| **RT-06** | Internal link same tenant, weak unresolved, missing, foreign, tombstoned, wrong type | Same-tenant resolves; weak renders text; all invalid/foreign block or refuse correctly |
| **RT-07** | Image with alt, caption, hotspot, crop; decorative image; missing/foreign asset | Metadata round-trips; missing asset blocks and renders placeholder |
| **RT-08** | File asset with title and MIME type; missing asset | Metadata round-trips; native delivery link only |
| **RT-09** | Unknown block style, list type, decorator, annotation type, and inline object | Preserved in quarantine; publish blocked; no HTML rendering |
| **RT-10** | Unknown node containing a source `_ref` | Quarantined; no `_ref` in active payload; raw source private; publish blocked |
| **RT-11** | Unknown fields on known block/span/link nodes | Preserved; no semantic change; publish allowed |
| **RT-12** | Duplicate/missing `_key`, non-span child, missing mark definition, list item without level | Invalid; publish blocked; deterministic diagnostic |
| **RT-13** | Script tags, event handlers, `javascript:`, `data:text/html`, SVG, style injection, encoded schemes | No execution; invalid/unsafe content blocks publish and renders inert |
| **RT-14** | Unicode, RTL, emoji, combining marks, zero-width characters, long text | Exact text preservation; no unsafe control characters |
| **RT-15** | Canonical known document through source → native → source | Exact canonical equality and digest; no field or order loss |
| **RT-16** | Unknown document through source → native → archive → source | Archive exact; active envelope digest stable; no `_ref` or private path leak |

Every fixture records:

- source JSON (private);
- canonical native JSON;
- render tree or golden HTML;
- diagnostic codes;
- publish decision;
- known-document digest and unknown-archive digest;
- tenant/reference/asset resolution result.

## 9. Acceptance gates

### RG-1 — Field designation

No field is treated as rich text until the C0 field mapping names it, the owner approves the promotion, and the source shape is recorded. Plain `text` fields remain plain text; no automatic Markdown or Portable Text inference.

### RG-2 — Supported-node coverage

Every supported block style, list variant, decorator, link, internal link, image, and file has a positive render and round-trip fixture. No supported node is represented only by prose.

### RG-3 — Reference and asset safety

Same-tenant references resolve; foreign, missing, tombstoned, purged, wrong-type, and unresolved references fail closed. No active rich-text payload contains a Sanity `_ref`, CDN URL, or storage key.

### RG-4 — Unknown preservation

Every unknown node is preserved, quarantined, and publish-blocked. Unknown fields on known nodes survive without blocking. No unknown node is silently converted to HTML or dropped.

### RG-5 — Sanitization

Raw HTML is never executed. Invalid URLs, raw HTML nodes, unsafe attributes, external image URLs, and encoded schemes block publish and render inert. The renderer does not use raw HTML injection.

### RG-6 — Round trip

All 16 RT fixtures pass with zero skipped and zero todo. Known documents are canonical-equal; unknown documents preserve the private archive and stable active envelope.

### RG-7 — Determinism

The same document, tenant, references, assets, and renderer version produce the same render tree, HTML, diagnostics, and digest. Reordering object keys in input does not change the canonical digest; array order does.

### RG-8 — Integration boundary

The contract does not close C1 by itself. C1 still requires 50/50 repository cases. C2 still requires route/render integration. C5 still requires real-export evidence. Rich-text fixtures are additional evidence, not a replacement.

## 10. Dependencies and stop points

| Dependency | Why |
|---|---|
| C0 field mapping and signed ownership manifest | Decides which fields are rich text and which tenant owns the content. |
| C1 references and tenant-scoped repositories | Resolves internal links and assets without cross-tenant leakage. |
| Asset tenancy and sharing policy | Supplies native asset IDs, delivery, and missing/foreign behavior. |
| C2 render path | Consumes the render tree; must not introduce raw HTML. |
| C3 admin/editor | Must preserve unknown nodes and show quarantine diagnostics, not silently strip. |
| C5 real-export rehearsal | Proves production-shaped rich text and unknown-node archives, not only fixtures. |

Stop points:

1. Stop before promoting any plain `text` field to rich text without an owner-approved C0 mapping.
2. Stop before implementing a renderer without the canonical model, reference resolver, and sanitizer rules.
3. Stop if a supported node lacks a positive render or round-trip fixture.
4. Stop if an unknown node can publish, be dropped, or render as raw HTML.
5. Stop if an active payload contains a source `_ref`, Sanity CDN URL, external image URL, or storage key.
6. Stop if a foreign reference or asset can render as a live link/image.
7. Stop if any RT fixture is missing, skipped, or passing only because the renderer returns empty output.
8. Do not claim rich-text parity or C1/C5 completion from fixture-only evidence.

## 11. Explicit non-goals

This contract does not:

- promote any existing `text` field to rich text;
- add Portable Text schemas, editor plugins, renderers, sanitizers, or test code;
- define a Markdown dialect or HTML paste behavior;
- decide the image-transform or asset-delivery vendor;
- change C1's 50-case gate, C2 route behavior, C5 migration, or any provider status;
- authorize production import, public rendering, or a cutover.

No schema, repository, route, provider, or runtime behavior is changed by this document.
