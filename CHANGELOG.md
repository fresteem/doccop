# Changelog

All notable changes to doccop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0-beta.1] - 2026-05-20

### Added — snippet authoring APIs

- **`compileTextTokens(archive, options?)`** in `@doccop/core` — converts
  plain-text `{{key}}` tokens inside snippet `.docx` files into proper
  bare-key SDT elements. Lets users author snippets in Word as plain
  prose (no Developer tab, no Content Controls). Idempotent — running
  it twice is a no-op. Options:
    - `delimiters?: { open, close }` (default `{{` `}}`),
    - `validateKey?: (key) => boolean` (default `BARE_KEY_PATTERN`),
    - `onUnknownKey?: "ignore" | "warn" | "error"` (default `"ignore"`).
  Returns `{ archive, compiled, skipped }`. End-to-end test exercises
  `compileTextTokens → injectRequisites → render` to confirm authored
  tokens flow through the full pipeline.
- **`wrapBareKey(archive, location, spec)`** in `@doccop/core` — visual
  counterpart of `wrap` for snippet editors. Spec is
  `{ key, alias, dataType }` (no scope prefix). Emits
  `<w:tag w:val="${key}">` with the same overlap/rPr-preservation/run-
  splitting semantics as `wrap`.
- **`list()` signature: optional third arg `{ includeBareKey?: boolean }`.**
  Default `false` preserves pre-`0.2.0-beta.1` behaviour (template
  editors don't see snippet-internal bare-key SDTs). When `true`, bare-
  key SDTs surface with `scope: "bareKey"` and `key: tag`.
- **`VariableScope` union** grows by `"bareKey"` literal. Used by
  `list()` to discriminate bare-key entries from value/requisites ones.
- **`BARE_KEY_PATTERN`** and **`validateBareKey(key)`** exported for
  hosts that want to validate keys before calling the API.
- **`BareKeyPlaceholderSpec`** type exported.

### Fixed

- **`HtmlRenderer` runIndex bug** — previously incremented `runIndex`
  on both `<w:r>` and `<w:sdt>` branches, so a host that read
  `data-run-index` from the preview and passed it back to `wrap()`
  could trigger `PlaceholderNotFoundError: <paraId>/runs[1..1]` on
  paragraphs that started with an SDT. Now `runIndex` counts only
  `<w:r>` direct children, matching the engine's view via
  `listDirectRuns(paragraph)`. SDT anchor entries keep `indexInPara`
  reporting the run count at SDT emission time. Regression test added.
- **`wrap()` error message** for out-of-range run indices is now
  diagnostic: `<paraId> (run index N..M out of range; paragraph has K
  run(s))` instead of the confusing `<paraId>/runs[N..M]` format that
  read like a missing-placeholder lookup.

### Added — documentation & demo

- **`demo-app/`** — runnable end-to-end example as a workspace at the
  repo root. CLI mode (`npm run cli`) builds a Ukrainian contract
  template, renders it via the engine directly, writes `output.docx`.
  Server mode (`npm run start`) boots Fastify with `@doccop/server`,
  in-memory stores, sample resolvers, and an `x-user-id`-trusting
  `AuthAdapter`. Includes curl examples for upload / wrap / render.
  `typescript` + `tsx` are declared as workspace devDeps so the demo
  builds without the repo-root install path.
- **`docs/QUICKSTART.md` body** — 10-minute walkthrough from install to
  first rendered document. Library-only path, no infrastructure.
- **`docs/INTEGRATION.md` body** — adapter-by-adapter walkthrough with
  working code samples (S3 storage, JWT auth, pino logger, Postgres
  numbering, Fastify wire-up). Full `DocCopErrorCode → HTTP status`
  table. i18n guidance. Migration patterns from docxtemplater /
  Carbone. New "Authoring snippets via API" section covering
  `compileTextTokens` and `wrapBareKey`.
- **`docs/ARCHITECTURE.md` body** — internal design walkthrough covering
  every subsystem (docx parsing, placeholder engine, preview, render
  pipeline, requisites injection, server layer, Postgres reference)
  plus cross-cutting concerns (errors, concurrency, observability,
  versioning).
- **`docs/RELEASE_PROCESS.md` body** — release channels, promotion
  criteria, v1.0 stable checklist, version coordination rules,
  deprecation policy, rollback procedure, release-day checklist.
- **Per-package `README.md` + `LICENSE`** for `@doccop/core`,
  `@doccop/server`, `@doccop/storage-postgres` — required for clean
  npm publish (without these the packages show "no README" on
  npmjs.com).
- **`CODE_OF_CONDUCT.md`** — adopts Contributor Covenant 2.1 by
  reference.
- **`.github/ISSUE_TEMPLATE/`** (bug-report, feature-request, config)
  and **`.github/PULL_REQUEST_TEMPLATE.md`** — structured contribution
  intake.

### Cleanups (no public-API impact)

- Cleaned 14 `@throws {ErrorType}` JSDoc patterns to
  `@throws ErrorType — …` form across `@doccop/core`. api-extractor's
  `tsdocMessageReporting` silenced as defence-in-depth.
- `routes/templates.ts` mutual-exclusion dispatcher between `wrap` and
  `wrapBlock` simplified — final `else` throws a typed
  `InvalidPlaceholderTagError` instead of returning the unmodified
  archive (was a dead branch only reached when both `location` and
  `blockRange` were absent).
- `wrap` / `wrapBlock` internal refactor: shared `performInlineWrap`
  helper so `wrapBareKey` reuses the run-splitting machinery without
  duplication.

## [0.2.0-beta.0] - 2026-05-20

### Added
- **`wrapBlock` now accepts paragraphs inside `<w:tc>` (table cells) and
  inside non-requisites `<w:sdtContent>`** in addition to `<w:body>`.
  Real-world legal templates frequently lay out "requisites" content
  inside layout tables; the engine no longer forces the host to lift
  selections out of the cell. The SDT is inserted as a sibling INSIDE
  the shared container, not promoted to `<w:body>`. Nesting inside an
  existing `requisites:*` SDT is rejected with
  `OverlappingPlaceholderError`. New tests cover single-cell wrapping,
  multi-paragraph cell wrapping, multi-cell rejection, body regression,
  and nested-in-non-requisites SDT.
- **End-to-end render integration test** for a requisites block SDT
  nested inside a table cell. Confirms `RequisitesEngine.locateBlockSdts`
  finds the SDT at any depth (already recursive via `findElements`) and
  that the injected snippet content lands inside the cell.
- **`docs/QUICKSTART.md`** — runnable ten-minute walkthrough from
  `npm install` through first render. Covers `wrap`, `EntityResolver`
  shape, `RenderRequest` / `RenderConfig`, strict-vs-non-strict mode.
- **`docs/INTEGRATION.md`** — adapter-by-adapter integration guide with
  working code samples (S3 storage, JWT auth, pino logger, Postgres
  numbering, Fastify wire-up). Includes the full `DocCopErrorCode` →
  HTTP status table, i18n guidance, and migration patterns from
  docxtemplater / Carbone / template-strings-in-DB hosts.
- **`README.md` quickstart** — replaces the "Coming in Wave 13"
  placeholder with a real `npm install` + minimal render example and
  links into the docs.

### Fixed
- Cleaned up dead-code fallback (`: archive`) in
  `POST /v1/templates/:id/placeholders` route handler — now uses an
  explicit `if/else if/else` chain where the final `else` throws a
  typed `InvalidPlaceholderTagError` instead of returning the
  unmodified archive. Behaviour unchanged for valid requests; better
  signal-to-noise for readers.
- Cleaned up 14 `@throws {ErrorType}` JSDoc patterns across
  `@doccop/core` to `@throws ErrorType — …` form. Cosmetic; the
  api-extractor `tsdocMessageReporting` is now also silenced so
  pre-existing patterns wouldn't fail CI again.

### Changed
- `PlaceholderWrapInput.location` is now optional (since `0.2.0-alpha.0`
  when `blockRange` was added). Consumers destructuring
  `input.location.paraId` without an optionality check will need to
  guard with `?.` or branch on which field is present. Note: this is a
  TypeScript-level shape change only; HTTP clients sending
  `{ location: {...} }` continue to work unchanged.

### Added
- **`PlaceholderEngine.wrapBlock(archive, { startParaId, endParaId }, spec)`**
  in `@doccop/core` — wraps an inclusive range of top-level paragraphs
  into a block-level `<w:sdt>`. Intended for marking whole-paragraph
  regions as `requisites:party_X` injection points. Mirrors `wrap()`'s
  immutability contract; throws `InvalidPlaceholderTagError` /
  `PlaceholderNotFoundError` / `OverlappingPlaceholderError` per the
  same conventions. Single-paragraph blocks (`startParaId === endParaId`)
  are supported. New exported type `BlockWrapLocation`.
- **`Logger` interface and `NoopLogger`** default export in `@doccop/core`
  — host-injectable structured logger contract on `DocCopConfig.logger`.
  Engine emits no log lines as of this release; behavioural integration
  lands in a follow-up minor without further public API changes.
- **API surface snapshot tests** via `@microsoft/api-extractor` for all
  three published packages. Snapshots committed at
  `packages/*/etc/<unscoped>.api.md`. `npm run api:check` (also a CI step)
  fails on any change to these without an explicit `breaking-change` PR
  label and a populated `docs/migrations/X.Y-to-X.Y+1.md` entry.
- **License-check automation** in CI (`license-checker`). Allowlist:
  MIT / BSD-2 / BSD-3 / Apache-2.0 / ISC / CC0-1.0 / CC-BY-4.0 / 0BSD /
  Python-2.0 / BlueOak-1.0.0.
- **CI matrix:** Node 20 + Node 22 with `fail-fast: false`.
- **Real-world `.docx` corpus scaffold** at `test/fixtures/real/` with
  curation rules. Initial corpus is empty; `packages/core/test/integration/real-corpus.test.ts`
  gracefully skips until files land, then asserts parse and round-trip
  stability per file.
- **Documentation scaffolding:** `AGENTS.md` (tool-agnostic agent rules
  per agents.md spec), `SECURITY.md` (disclosure + threat model),
  `docs/QUICKSTART.md`, `docs/INTEGRATION.md`, `docs/ARCHITECTURE.md`,
  `docs/RELEASE_PROCESS.md`, `docs/migrations/TEMPLATE.md` (boilerplate
  for breaking-change PRs).
- **Five agent definitions** under `.claude/agents/` for project-specific
  work decomposition (`doccop-backend-dev`, `doccop-headless-ui`,
  `doccop-test-engineer`, `doccop-docs-writer`, `doccop-release-guardian`).
- **Server schema:** `PlaceholderWrapSchema` accepts optional `blockRange:
  { startParaId, endParaId }`. The existing `location` field is now also
  optional. The `POST /v1/templates/:id/placeholders` route enforces
  mutual exclusion in the handler and dispatches to `wrap` or
  `wrapBlock` accordingly. Both/neither variants return 400 with
  `INVALID_PLACEHOLDER_TAG`.

### Changed
- `README.md`: demo-app stack corrected to Fastify (was Express).

### Fixed
- **`PlaceholderEngine.replace` now preserves `<w:rPr>` from the wrapped
  content's first descendant run.** Previously the run-property element
  was discarded, dropping bold / italic / font-size / colour / font-
  family from substituted values — critical regression for legal
  documents where signatory names and IBANs are typically bold. Six new
  tests cover preservation, fallback when no run is present, and per-SDT
  fidelity across multi-binding tags. Known limitation: when an SDT body
  contains multiple runs with differing formatting, only the first run's
  `<w:rPr>` is applied (documented in the TSDoc).

### Dependencies (devDependencies only)
- `@microsoft/api-extractor` ^7.47.0 (MIT)
- `license-checker` ^25.0.1 (BSD-3-Clause)

### Unreleased (prior wave history below)

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
