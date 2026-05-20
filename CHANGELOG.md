# Changelog

All notable changes to doccop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Wave 1: monorepo scaffold, `@doccop/core` interfaces, base CI.
- Wave 2: docx subsystem.
  - `DocxParser` — pizzip-backed parse/serialize with 10 MiB size cap.
  - `AnchorMapper` — ensures every paragraph has a stable `w14:paraId`
    (Word's native paragraph identifier; survives edits, moves, splits).
  - `xml-utils` — XXE-prevention sweep (rejects `<!ENTITY>` declarations)
    + safe namespace-aware element queries.
  - `fixtureBuilder` for tests — generates minimal valid .docx in memory.
- Dependencies: `pizzip@3.2.0` (MIT/GPL dual, MIT chosen) and
  `@xmldom/xmldom@0.9.10` (MIT). Both verified license-compatible.
- Wave 3: HTML preview renderer.
  - `HtmlRenderer.render(archive) → { html, anchors }` walks document.xml
    and emits a body-only HTML fragment annotated with stable
    `data-anchor-id` (paraId) and `data-run-index` attributes.
  - SDT placeholders render as styled spans/divs with `data-tag` and
    `data-alias` for UI interaction (inline + block variants).
  - `style-mapper` translates direct `<w:rPr>` / `<w:pPr>` properties to
    inline CSS: bold, italic, underline, strike, font-size (half-points
    → pt), color (#RRGGBB), alignment, left indentation.
  - `escape` helpers: defence-in-depth attribute escaping (escapes `<`
    and `>` in attributes too, not just `&` and `"`).
  - Tables rendered as native HTML tables.
  - All text and attribute values escaped — XSS-safe.
- Wave 4: PlaceholderEngine — SDT wrap/unwrap/list/replace.
  - `wrap(archive, loc, spec)` — wraps a paragraph-anchored text
    selection in a new `<w:sdt>` placeholder. Splits runs mid-text when
    selection boundaries fall inside them, preserving `<w:rPr>`
    formatting on every resulting piece. Same-run mid-mid selections
    produce three runs (left, wrapped middle, right). Cross-run selections
    handled similarly.
  - `unwrap(archive, tag)` — removes the matching SDT, restores its
    content to the parent.
  - `list(archive, dataTypes?)` — enumerates every placeholder in
    document order with scope/key decomposition and paraId anchor.
  - `replace(archive, tag, value)` — substitutes content (used by
    DocxRenderer in Wave 5). Multiple SDTs with the same tag are all
    updated (Word "data binding" pattern).
  - Tag validation: `<scope>.<key>` (party_a/system/custom) or
    `requisites:party_<id>`. Length 1..100, lowercase alphanumeric
    with underscores. Alias 1..200 chars, no ASCII control characters.
  - Overlap detection: refuses to wrap a range that crosses an existing
    SDT (`OverlappingPlaceholderError`).
  - All mutations clone the archive — input is never touched.
- Wave 5: DocxRenderer — variable substitution pipeline.
  - `render(template, request, config, dataTypes?)` walks every SDT,
    routes by scope to matching `EntityResolver`, validates the result
    against the placeholder's declared data type, substitutes via
    `PlaceholderEngine.replace`.
  - Two-pass design: resolve everything first (no mutation), then apply
    substitutions on a clone. Strict-mode failures throw before any
    mutation — callers always get an all-or-nothing result.
  - Strict mode (default): missing resolver / absent value / type
    validation failure / requisites without resolver → throws.
  - Non-strict mode: collects `RenderWarning[]`, substitutes
    `{missing: <tag>}` marker text for missing values, completes.
  - 10 runtime data type validators: text, number, integer, date (ISO),
    boolean, edrpou (8 digits), rnokpp (10 digits), iban (normalises
    spaces/case), email, phone (9-15 digits with punctuation).
  - Requisites tags surfaced as `snippet_missing` warning (Wave 6 lands
    actual XML injection).
  - Image substitution out of scope for v1 — surfaces a warning.
  - `RenderResult` returns `docx` bytes, `resolvedValues` audit map,
    `warnings`, `durationMs`.
- Wave 6: RequisitesEngine — per-subtype block injection.
  - `injectRequisites(req)` orchestrates: parse snippet → ensureParaIds
    → rewrite bare-key tags to scoped form → render placeholders via
    `DocxRenderer` → remap styles/numbering/bookmarks → splice into
    master → merge auxiliary parts.
  - `TagRewriter` — bare `{{full_name}}` → `{{party_a.full_name}}`
    based on the target party slot. Rejects nested `requisites:*`
    (no recursion). Leaves already-qualified tags alone.
  - `StyleRemapper` — prefixes every snippet styleId with a salt
    (`s1_Heading1`), updates body `<w:pStyle>`/`<w:rStyle>`/`<w:tblStyle>`
    refs and intra-styles `<w:basedOn>`/`<w:next>`/`<w:link>` cross-
    references. Merges into master via `mergeStylesIntoMaster`.
  - `NumberingRemapper` — offsets snippet `<w:numId>` and
    `<w:abstractNumId>` above master's max, updates body `<w:numId>`
    refs and inner `<w:abstractNumId>` refs inside `<w:num>`.
  - `BookmarkRemapper` — rerandomizes `<w:bookmarkStart>`/`<w:bookmarkEnd>`
    ID pairs to 31-bit positive integers.
  - `XmlInjector` — locates block-level `<w:sdt>` (not inside `<w:p>`)
    in master, extracts snippet body's top-level `<w:p>`/`<w:tbl>`
    children, deep-clones them into the master document via
    `importNode`, replaces SDT.
  - `SnippetArchive` — lazy-parses styles.xml / numbering.xml /
    document.xml.rels from `rawParts` on demand; writes merged
    versions back via `writeAuxiliaryParts`.
  - `resolveAndInject` — strict-mode-aware wrapper that the
    `DocxRenderer` calls per requisites placeholder.
  - DocxRenderer refactored to two-phase: Phase 1 injects requisites,
    Phase 2 substitutes value placeholders against the (now-larger)
    document. Strict-mode failures throw before any mutation reaches
    serialization.
  - Snippets parsed with `ensureParaIds` so `PlaceholderEngine.list()`
    surfaces SDTs regardless of authored paraId format.
  - Image rels remain a v2 extension point (snippets are text-only by
    convention).
- Wave 7: `@doccop/server` — Fastify plugin exposing `/v1/*` routes.
  - `doccopRoutes` plugin registers under the host's chosen prefix;
    plugins own auth (via configured AuthAdapter), error mapping,
    rate limiting, and idempotency.
  - `POST /v1/templates` — multipart upload .docx, parses + normalises
    via `parse`/`ensureParaIds`/`serialize`, creates v1 record.
  - `GET /v1/templates`, `GET /v1/templates/:id`.
  - `GET /v1/templates/:id/preview` — HTML preview via `preview()`.
  - `POST /v1/templates/:id/placeholders` — `wrap` with optimistic
    locking against `expectedVersionId`, creates new version.
  - `DELETE /v1/templates/:id/placeholders/:tag` — `unwrap`.
  - `POST /v1/snippets` — admin-only upload, upserts by (entityType,
    entitySubtype), bumps version.
  - `GET /v1/snippets`, `DELETE /v1/snippets/:id`.
  - `POST /v1/documents` — render with Idempotency-Key support
    (returns cached on repeat), rate-limited per user.
  - `GET /v1/documents`, `GET /v1/documents/:id` — own-only.
  - Zod schemas for every request body + param.
  - `DocCopError` → HTTP status mapping covers all 19 engine error
    codes (4xx for input issues, 5xx for storage/render failures).
  - `InMemoryRateLimiter` enforces concurrent + per-minute limits per
    user (defaults 5 concurrent / 60 per minute).
  - Storage interfaces split into `StorageAdapter` (blobs, from core),
    `TemplateStore`, `TemplateVersionStore`, `SnippetStore`,
    `SnippetVersionStore`, `DocumentStore`, `IdempotencyStore`,
    `DataTypeRegistry` — hosts implement each against their DB.
  - In-memory reference impls live under `test/helpers.ts` (~250 LoC),
    used by the integration tests and serve as a template for hosts.
- Dependencies added (all MIT):
  - fastify@5.2.1, @fastify/multipart@9.0.3, zod@3.24.1.
- Exposed engine surface: re-exports `parse` / `serialize` /
  `ensureParaIds` / `list` / `wrap` / `unwrap` / `replace` / `render` /
  `preview` from `@doccop/core` main barrel (was Wave 1-6 only types
  before).
- Wave 8: `@doccop/storage-postgres` — reference store impls.
  - Drizzle ORM schema mirroring every server interface (7 tables).
  - SQL migration `migrations/0000_init.sql` ready to apply against
    any Postgres 14+ instance.
  - Concrete classes for every store: `PostgresTemplateStore`,
    `PostgresTemplateVersionStore`, `PostgresSnippetStore`,
    `PostgresSnippetVersionStore`, `PostgresDocumentStore`,
    `PostgresIdempotencyStore`, `PostgresDataTypeRegistry`. All wired
    against a host-provided Drizzle handle — package never opens its
    own connection.
  - `PostgresTemplateStore.setCurrentVersion` uses optimistic locking
    via `UPDATE … WHERE current_version_id = expected` precondition
    (server maps a null return to 409 Conflict).
  - `PostgresSnippetStore.upsert` uses `ON CONFLICT (entity_type,
    entity_subtype) DO UPDATE` so admin "replace snippet" is a
    single round trip.
  - `PostgresIdempotencyStore.store` uses `ON CONFLICT DO NOTHING` to
    avoid unique-violation races on replays. Includes a
    `cleanupOlderThan(date)` helper for host cron jobs.
  - `PostgresDataTypeRegistry.seed(rows)` convenience for populating
    the variables catalogue from a static list.
  - `FilesystemBlobStorage` — disk-backed `StorageAdapter` for the
    demo app. Sanitises owner ids, blocks path-traversal attempts,
    wraps fs errors in `StorageFailedError`.
- Dependencies added (all MIT/Apache-2.0):
  - drizzle-orm@0.36.4 (Apache-2.0)
  - postgres@3.4.5 (MIT)
