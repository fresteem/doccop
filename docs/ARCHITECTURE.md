# Architecture

Internal design of doccop. Read this when you want to understand *why* the engine is shaped the way it is — for contributing, forking, or implementing your own host adapter at the level where the interface contract isn't enough on its own.

## Design principles

1. **Host-agnostic.** No assumption about the consuming database, storage backend, web framework, or identity system. Every external concern lives behind an interface in `@doccop/core/types.ts` (`StorageAdapter`, `EntityResolver`, `RequisitesResolver`, `NumberingService`, `NamingService`, `AuthAdapter`).
2. **Reentrant.** No global mutable state in the engine. Multiple renders run concurrently in a single process; the only stateful component in `@doccop/server` is the in-memory rate limiter, which is per-instance by design.
3. **Word-native.** Placeholders are `<w:sdt>` content controls — exactly what Microsoft Word writes when a user inserts a content control via the ribbon. Templates round-trip cleanly: Word edits don't break the engine, and engine edits open cleanly in Word.
4. **MIT all the way down.** Every transitive dependency is MIT / BSD / Apache-2.0 / ISC. CI fails on disallowed licenses. Where a permissive option doesn't exist, we write the code ourselves — the Wave 6 requisites injector (~1500 LoC of MIT code) replaces docxtemplater's commercial `subtemplate-module`.
5. **Strict by default.** Render failures throw loudly. Non-strict mode is opt-in for previews. Document generation is high-stakes — silent gaps are how the wrong contract reaches a client.
6. **Immutable archives.** Every mutation function clones the `DocxArchive` and returns a fresh copy. Inputs are never touched. Caller never has to worry whether a returned archive aliases an earlier one.

## The `DocxArchive`

```typescript
interface DocxArchive {
  /** Parsed word/document.xml as an xmldom Document. */
  document: Document;
  /** Every other ZIP entry, by archive-relative path. */
  rawParts: Map<string, Uint8Array>;
}
```

- **Two-tier storage.** `document` is what we manipulate; `rawParts` is everything else the `.docx` archive contains (styles, numbering, settings, theme, fonts, images, headers, footers, custom XML). The engine only modifies `document` and a small number of auxiliary parts (styles.xml, numbering.xml, document.xml.rels) during requisites injection.
- **Why pizzip + xmldom, not a wrapper library.** Most "OOXML libraries" are either commercial (docxtemplater paid modules, Aspose, …) or AGPL-licensed (officegen). The pizzip + xmldom combination is the smallest possible permissive surface that gives us a real ZIP reader and a namespace-aware DOM. We carry the engineering cost of knowing OOXML in exchange for a clean license.
- **Round-trip discipline.** `parse(serialize(archive))` is a documented invariant. The serializer preserves namespace declarations, attribute ordering on root elements, and xml:space handling. Tests assert round-trip stability against both programmatic fixtures and (planned) a real-world Word corpus.

## docx subsystem (`packages/core/src/docx/`)

### `DocxParser`

- **Resource limits.** Templates over 10 MiB (`maxTemplateBytes`) are rejected before parsing — `TemplateTooLargeError`. The limit is configurable via `EngineLimits` but defaults to a value that fits every legal-domain template we've seen plus an order of magnitude.
- **XXE prevention.** Every XML payload (`document.xml`, `styles.xml`, etc.) is passed through `parseXmlSafely`, which rejects any input containing `<!ENTITY` declarations (`XxeDetectedError`). The check is a substring scan before parser construction — paranoid by design, since xmldom's entity handling has historically been a moving target.
- **Structural validation.** The archive must contain a `word/document.xml` entry. Missing entries are rejected (`MalformedDocxError`). Malformed XML inside `document.xml` is also rejected (same error class, different message).

### `AnchorMapper`

- **Word's `w14:paraId`.** Word writes an 8-character uppercase hex identifier on every paragraph in its modern documents. The identifier survives edits, splits, and copy-paste operations across documents — Word manages collision avoidance natively. We piggyback on this rather than minting our own paragraph IDs, because Word users routinely move paragraphs between templates and we want anchors to survive.
- **`ensureParaIds(archive)`** walks every `<w:p>` and mints an 8-hex-digit uppercase ID for any paragraph lacking one. Collision avoidance is by `crypto.randomBytes(4)` against the set of already-seen IDs. The 2^32 space makes single-document collisions astronomically rare.
- **`listParagraphs`** returns `{ paraId, element }` for every paragraph in document order. This is the building block for `findParagraphByParaId` (used by `wrap` / `wrapBlock`) and for the HTML preview's anchor table.

### `xml-utils`

- **Namespace constants** for the WordprocessingML namespace (`W_NS`) and Word 2010 extensions (`W14_NS`). All element queries use these explicitly via `findElements(root, ns, localName)`.
- **`findElements`** is intentionally recursive (`getElementsByTagNameNS` semantics). Block SDTs may live anywhere in the tree — inside `<w:body>`, inside table cells, inside nested SDTs. The render-time SDT locator relies on this depth-independence.

## Placeholder editing (`packages/core/src/placeholders/`)

### SDT structure

What the engine writes:

```xml
<w:sdt>
  <w:sdtPr>
    <w:tag w:val="party_a.full_name"/>
    <w:alias w:val="Сторона А — повна назва"/>
    <w:lock w:val="contentLocked"/>
  </w:sdtPr>
  <w:sdtContent>
    <!-- wrapped runs / paragraphs go here -->
  </w:sdtContent>
</w:sdt>
```

- **`tag`** carries the engine binding. Two accepted shapes: `<scope>.<key>` for value placeholders (`party_a.full_name`, `system.today`, `custom.amount`) and `requisites:party_<id>` for block-level injection markers. Strict validation in `TagValidator.decomposeTag`.
- **`alias`** is the human-readable label. Shown by Word's content-control UI and by our HTML preview.
- **`lock w:val="contentLocked"`** prevents users from editing the placeholder content directly in Word. They have to go through the editor to change the binding — which is what we want, since freeform editing of an SDT's content would break the engine's substitution contract.

### `wrap`

Wraps an inline text selection inside one paragraph.

- **`WrapLocation`** is positional: `{ paraId, startRunIndex, startOffset, endRunIndex, endOffset }`. The HTML preview exposes the matching `data-anchor-id` / `data-run-index` attributes so a browser's `Selection` can be converted directly into this shape.
- **Run splitting.** If the selection starts or ends inside a run (offset > 0 / offset < runText.length), we split that run, preserving its `<w:rPr>` on both halves. Cross-run selections wrap the in-between runs whole.
- **"Complex run" guard.** A run containing tabs (`<w:tab>`), breaks (`<w:br>`), or multiple text segments is "complex" — we refuse to split it mid-text. The UI is expected to disable wrapping on such selections (the HTML preview signals this via a `data-complex-run` attribute on the rendered span).
- **Overlap guard.** If an existing `<w:sdt>` sits anywhere in the selection range, `wrap` refuses with `OverlappingPlaceholderError`. The caller must `unwrap` the existing SDT first.

### `wrapBlock` (since 0.2.0)

Wraps an inclusive range of paragraphs in a **block-level** SDT.

- **Three accepted containers:** `<w:body>`, `<w:tc>` (table cell), `<w:sdtContent>` of a non-requisites SDT. The motivation is Ukrainian legal contracts that lay out requisites blocks inside layout tables — we wrap in place rather than forcing the editor to lift content out of the cell.
- **Range walk.** Starting at `startParaId`, walk `.nextSibling` until reaching `endParaId`. Intermediate elements (more paragraphs, tables, anything that isn't an SDT) get pulled into the new SDT. Hitting an existing SDT mid-range raises `OverlappingPlaceholderError`.
- **Nesting policy.** A `wrapBlock` inside an existing `requisites:*` SDT is rejected — `RequisitesEngine` itself forbids nested requisites blocks because it cannot render them (a snippet expansion that contains its own snippet expansion has unbounded recursion).

### `replace`

Substitutes the content of every SDT matching a tag with a single run containing the resolved value. Multiple matches are touched — this is how Word's "data binding" pattern works: same content control appears in many places, all show the same value.

- **`<w:rPr>` preservation (since 0.2.0-alpha.0).** Before wiping the existing SDT content, capture `<w:rPr>` from the first descendant run via depth-first search. Apply that `<w:rPr>` to the substituted run. This keeps bold / italic / colour / font-size / font-family on placeholder text — critical for signatory names and IBANs that are conventionally bold.
- **Known limitation.** When the SDT body contains multiple runs with differing formatting (rare; happens after wrapping a selection that crossed a formatting boundary), only the *first* run's `<w:rPr>` is applied. Documented in the JSDoc.

### `list` and `unwrap`

- **`list(archive, dataTypes?)`** enumerates every well-formed placeholder in document order. SDTs with tags that don't match the `<scope>.<key>` / `requisites:party_<id>` shape are silently skipped — the catalogue only surfaces tags the engine knows how to resolve.
- **`unwrap(archive, tag)`** removes the SDT wrapper and moves the wrapped content back to the parent. Used to undo a wrap or to remove a binding before re-wrapping.

## HTML preview (`packages/core/src/preview/`)

- **`render(archive) → { html, anchors }`** walks `document.xml` and emits a body-only HTML fragment annotated with `data-anchor-id` on every paragraph and `data-run-index` on every run. SDT placeholders render as `<span data-tag="..." data-alias="...">` for inline and `<div data-tag="..." data-block="true">` for block-level — letting the browser-side editor distinguish click targets.
- **Style mapping** translates Word's direct formatting (`<w:rPr>`, `<w:pPr>`) to inline CSS: bold (`font-weight`), italic, underline, strikethrough, font-size (half-points → pt), colour (`#RRGGBB`), alignment, left indentation. Conscious omission: paragraph-style references (`<w:pStyle>`) are not resolved against `styles.xml` — the preview is for visual identification of placeholders, not pixel-perfect rendering. For pixel-perfect, hosts integrate Mammoth or LibreOffice headless.
- **XSS defence.** Every dynamic value (text content, attribute values, alias strings) is escaped via `escapeHtml` / `escapeAttr`. The attribute escape is paranoid: it escapes `<` and `>` in addition to `&` and `"`, against the HTML spec's relaxed attribute-content rules. Defence-in-depth — placeholder aliases and tags can in principle come from user input.

## Render pipeline (`packages/core/src/render/`)

The most user-visible subsystem. `render(archive, request, config, dataTypes?)` substitutes every placeholder, returns the resulting `.docx` bytes plus an audit map and warnings.

### Two phases, in order

**Phase 1 — requisites injection.**

- Scan for every `<w:sdt>` whose tag starts with `requisites:party_*`.
- For each: look up the target party's entity subtype (via the party's regular resolver — `resolve("subtype", ctx)`), ask the `RequisitesResolver` for the matching snippet, and call `RequisitesEngine.resolveAndInject` to splice the snippet body in.
- This MUST happen before Phase 2 because injected snippet bodies may themselves carry value placeholders that Phase 2 needs to resolve.

**Phase 2 — value placeholder resolution.**

- Re-list all placeholders (the document is now larger thanks to Phase 1).
- For each value SDT: locate the matching resolver by `scope`, call `resolver.resolve(key, ctx)`, validate the result against the declared `DataType`, collect into a `PendingSubstitution`.
- Once every placeholder is resolved (or warned about, in non-strict mode), apply the substitutions via `PlaceholderEngine.replace`.

The two-pass-within-Phase-2 pattern is deliberate: gather every substitution before applying any mutation. In strict mode, the first resolver failure throws before any byte is written, so the caller never gets a half-rendered document.

### Type validation

`validateValue(dataType, tag, raw)` enforces ten data types: `text`, `number`, `integer`, `date` (ISO-8601), `boolean`, `edrpou` (Ukrainian legal-entity ID: 8 digits), `rnokpp` (Ukrainian personal tax ID: 10 digits), `iban` (normalises spaces + uppercase), `email`, `phone` (9-15 digits with punctuation allowed). Failures raise `TypeValidationFailedError` in strict mode, become `type_mismatch` warnings otherwise.

### Modes

- **Strict (default).** Missing resolver → `NoResolverForScopeError`. Absent value → `AbsentValueInStrictModeError`. Type mismatch → `TypeValidationFailedError`. Resolver throws → `ResolverFailedError`. Snippet missing → `AbsentValueInStrictModeError`. Every failure short-circuits before serialization.
- **Non-strict (opt-in).** Missing values substitute a `{missing: <tag>}` marker text. Warnings accumulate in `RenderResult.warnings`. The caller decides whether to surface the warnings to the end user.

### Outputs

`RenderResult` is a value object: `{ docx, resolvedValues, warnings, durationMs }`. The `resolvedValues` map is keyed by full tag (`party_a.full_name`) — it's the audit trail that `DocumentStore.create` persists.

## Requisites injection (`packages/core/src/requisites/`)

The single largest subsystem (~1500 LoC) and the one that distinguishes doccop from a simpler templating engine.

### Why this exists

Ukrainian legal contracts (and similar host domains) need different "boilerplate" sections per entity subtype: a TOV (limited-liability) gets one block of requisites, a FOP (sole-proprietor) gets a different block with different fields. Encoding that as branching in the master template would explode the template count; instead, the master declares a marker (`requisites:party_a`) and the engine swaps in a per-subtype snippet at render time.

### Pipeline

For each `requisites:party_X` block SDT in the master:

1. **Resolve subtype.** Ask the party's resolver for `"subtype"` (convention key). The value is a free-form string (`"TOV"`, `"FOP"`, `"LLC"`, …) — semantically opaque to the engine.
2. **Resolve snippet.** Ask the configured `RequisitesResolver` for the `(entityType, entitySubtype)` snippet. `null` → `AbsentValueInStrictModeError` in strict mode, `snippet_missing` warning otherwise.
3. **Parse snippet.** Run the snippet bytes through `parse` + `ensureParaIds`.
4. **Rewrite snippet tags.** Snippets are authored with **bare keys** (no scope prefix): `{{full_name}}`, `{{edrpou}}`. The engine rewrites them to `{{party_X.full_name}}`, `{{party_X.edrpou}}` at injection time, where `party_X` is the target party slot. This lets one snippet bind to any party.
5. **Render snippet.** Call `DocxRenderer.render` recursively on the rewritten snippet. The snippet now contains a fully-substituted body.
6. **Remap styles.** Prefix every `styleId` in the snippet's `styles.xml` with a per-injection salt (`s1_`, `s2_`, …) — `Heading1` becomes `s1_Heading1`, etc. Update body `<w:pStyle>` / `<w:rStyle>` references and `<w:basedOn>` / `<w:link>` cross-references inside `styles.xml` itself.
7. **Remap numbering.** Offset snippet `<w:numId>` and `<w:abstractNumId>` above the master's max. Update body references and `<w:num>` inner references.
8. **Remap bookmarks.** Rerandomize `<w:bookmarkStart>` / `<w:bookmarkEnd>` ID pairs to fresh 31-bit positive integers.
9. **Splice into master.** Extract the snippet body's top-level block elements (`<w:p>`, `<w:tbl>`), import them into the master document (`Document.importNode`), and replace the block SDT with these elements at the same nesting depth.
10. **Merge auxiliary parts.** Write the merged `styles.xml` and `numbering.xml` back into the master's `rawParts`.

Steps 6–8 prevent style / numbering / bookmark ID collisions when the snippet defines its own `Heading1` (different from the master's) or its own numbering scheme.

### Constraints

- **No nested requisites.** Snippets are scanned for `requisites:*` tags and rejected (`SnippetCannotContainRequisitesError`). Unbounded recursion is the obvious failure mode.
- **No images in v1.** Snippets are text-only by convention. Image substitution requires DrawingML / rels rewriting / media file moves — listed as a v2 extension point.
- **`importNode` discipline.** Every block element transferred from the snippet document to the master is deep-cloned via `masterDoc.importNode(block, true)`. Without `importNode`, xmldom's owner-document checks would fail when the master is later serialized.

## Server layer (`packages/server/`)

A Fastify plugin (`doccopRoutes`) that wraps the engine in `/v1/*` HTTP endpoints.

- **Lifecycle.** The plugin owns: per-request auth (`AuthAdapter`), error mapping (`DocCopError → HTTP status`), idempotency check + storage, rate limiting, multipart upload streaming.
- **Zod boundary.** Every endpoint's request body and URL parameters pass through a Zod schema (`schemas.ts`) before any engine call. Malformed payloads short-circuit with `400` and a `ZodError`-shaped response.
- **Stores are interfaces.** The server doesn't depend on `@doccop/storage-postgres` — hosts wire whatever Drizzle / Prisma / TypeORM / hand-rolled SQL impl they prefer. The seven interfaces (`TemplateStore`, `TemplateVersionStore`, `SnippetStore`, `SnippetVersionStore`, `DocumentStore`, `IdempotencyStore`, `DataTypeRegistry`) are the only contract.
- **Idempotency model.** `Idempotency-Key` header + `userId` form a composite key. Repeat requests with the same key return the cached document (`200 cached: true`). Reusing a key for a *different* payload (sized-based dedupe is not attempted) raises `IdempotencyConflictError` → `409`.
- **Rate limiter design.** `InMemoryRateLimiter` tracks two budgets per user: concurrent renders (default 5) and renders-per-minute (default 60). Both are bounded counters, no leaks if the request handler throws. Multi-pod deployments swap this for a Redis-backed limiter.

## Postgres reference (`packages/storage-postgres/`)

- **Drizzle schema mirror.** Seven tables prefixed `doccop_` (templates, template_versions, snippets, snippet_versions, generated_documents, idempotency, variables). Initial migration ships as `migrations/0000_init.sql` for hosts that don't use drizzle-kit.
- **Optimistic locking** lives in `PostgresTemplateStore.setCurrentVersion`. The atomic check is `UPDATE … WHERE current_version_id = expected` — returns `null` on conflict, which the server maps to `409`.
- **Idempotency atomicity** uses `INSERT … ON CONFLICT (key, user_id) DO NOTHING`. Two concurrent calls with the same `(key, userId)` cannot both succeed; the loser silently no-ops.
- **`FilesystemBlobStorage`** is the reference `StorageAdapter`. It validates owner IDs against a UUID/slug pattern, refuses path-traversal attempts (`..` segments), and wraps every fs error in `StorageFailedError`. Production deployments swap this for S3 / GCS / Azure Blob / Supabase Storage.

## Cross-cutting

### Error handling

- **Every engine error subclasses `DocCopError`.** The base class carries a `code` (`DocCopErrorCode` union), a `message` (English, for logs), and an immutable `details` record (JSON-serializable parameter bag).
- **`code` is the i18n key.** Hosts that need localized end-user messages map `code` → translated template, interpolating `details`. The engine never imports an i18n library.
- **HTTP mapping** is exhaustive: every `DocCopErrorCode` has a status in `middleware/errors.ts`. Adding a new error code requires updating that table (and the `INTEGRATION.md` documentation).

### Concurrency model

- The engine is reentrant. No global state, no module-level mutable variables. Multiple `render` calls in flight share nothing.
- The server's rate limiter is the only stateful component — per-process, in-memory, bounded.
- Resolvers, stores, and the storage adapter are called concurrently across requests; their implementations are expected to be safe under that concurrency (DB connection pools, idempotent reads, atomic writes).

### Observability

- **`Logger` interface** (since `0.2.0-alpha.0`) is in `DocCopConfig.logger`. Default is `NoopLogger`. Hosts inject pino / winston / their own. The engine currently emits no log lines — the contract is in place so hosts can wire their logger before behavioural integration lands.
- **Render audit row.** Every successful render results in a `GeneratedDocumentRecord` with `variablesSnapshot`, `parties`, `templateVersionId`, `createdBy`, `createdAt`. This is the post-hoc trail of every document generated against the system.

### Versioning and compatibility

- **Public API surface set:** every export from `@doccop/core` and `@doccop/server` (including types), plus HTTP route paths, request/response shapes, and `DocCopErrorCode → HTTP status` mapping.
- **Mechanical guard:** every package ships an `etc/<pkg>.api.md` snapshot via `@microsoft/api-extractor`. CI regenerates and diffs; non-additive changes fail the `api:check` step until the PR is explicitly labelled `breaking-change` and the migration doc populated.
- **Cross-package version pinning.** All `@doccop/*` packages release together with exact-version inter-dependencies (`"@doccop/core": "0.2.0"`, no `^`). The release workflow publishes in dependency order: `core` → `server` → `storage-postgres`.
- **Migration guide template** at `docs/migrations/TEMPLATE.md`. Every breaking-change PR copies this to `docs/migrations/<from>-to-<to>.md` and links from the PR description.

## What's deliberately NOT in v1.0

- **Image substitution (signatures, logos).** Requires DrawingML / rels rewriting / EMU coordinate maths / media file moves. Listed as a v2 minor.
- **Headers / footers / footnotes** as first-class substitution targets. The current engine passes them through untouched, which covers ~99% of real-world templates we've examined. Substitution support is a v2 minor.
- **`@doccop/headless` + `@doccop/react-ui`.** Headless framework-agnostic UI primitives (state machines, DOM-Selection-to-WrapLocation mapper) plus a React adapter — Wave 14. Vue / Svelte adapters explicitly **out of scope**; the headless package's API is meant to be stable enough that community adapters can wrap it without our involvement.
- **Multi-tenant isolation at the engine level.** Tenant isolation is the host's concern — the engine sees a `userId` per request, and the host's `AuthAdapter` and stores are expected to enforce row-level visibility.
