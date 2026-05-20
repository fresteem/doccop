# Architecture

Internal design of doccop. Read this when you want to understand *why* something is shaped the way it is.

> **Status:** outline. Each section TODO before v1.0 stable. Owner: doccop-docs-writer.

## Design principles

1. **Host-agnostic.** No assumption about the consuming database, storage, framework, or identity system. Everything pluggable via interfaces in `core/types.ts`.
2. **Reentrant.** No global mutable state. Multiple renders run concurrently in one process.
3. **Word-native.** Placeholders are `<w:sdt>` content controls — what Word would have written itself. Templates open cleanly in Word.
4. **MIT all the way down.** No commercial library shall enter the dependency graph.
5. **Strict by default.** Render failures throw loudly. Non-strict mode is opt-in for previews.
6. **Immutable archives.** Every mutation function returns a fresh `DocxArchive`. Inputs are never touched.

## The `DocxArchive`

TODO — `pizzip` ZIP entries + parsed `document.xml` via xmldom. Why we keep both. The `rawParts` boundary.

## docx subsystem (`packages/core/src/docx/`)

TODO — `parse` / `serialize` round-trip discipline. `AnchorMapper` and Word's `w14:paraId`. XXE prevention in `parseXmlSafely`.

## Placeholder editing (`packages/core/src/placeholders/`)

TODO — SDT structure (`<w:sdt>` / `<w:sdtPr>` / `<w:sdtContent>`). Tag format `<scope>.<key>` and `requisites:party_X`. Run-splitting algorithm. Why we refuse to split "complex" runs.

## HTML preview (`packages/core/src/preview/`)

TODO — body-only fragment with `data-anchor-id` / `data-run-index`. Style mapping (half-points, EMUs, RGB). Defence-in-depth attribute escaping.

## Render pipeline (`packages/core/src/render/`)

TODO — two-phase design:
- Phase 1: expand `requisites:party_*` block SDTs by calling `RequisitesEngine`.
- Phase 2: resolve every value placeholder via the matching `EntityResolver`, validate against `DataType`, substitute via `PlaceholderEngine.replace`.

Two-pass within Phase 2: collect all resolutions before any mutation. Strict-mode failures throw before serialization.

## Requisites injection (`packages/core/src/requisites/`)

TODO — the most involved subsystem. Pipeline: parse → ensureParaIds → rewrite bare-key tags → render placeholders → remap styles/numbering/bookmarks → splice → merge auxiliary parts. Why each step exists.

## Server layer (`packages/server/`)

TODO — Fastify plugin lifecycle. Zod boundary. Error → HTTP mapping table. Idempotency model. Rate limiter design.

## Postgres reference (`packages/storage-postgres/`)

TODO — Drizzle schema mirror. Why optimistic locking lives in `setCurrentVersion`. Why `PostgresIdempotencyStore` uses `ON CONFLICT DO NOTHING`. `FilesystemBlobStorage` path-traversal defences.

## Headless UI (`packages/headless/`) (planned)

TODO — framework-agnostic primitives. DOM-`Selection` → `WrapLocation` mapper. Anchor map traversal. State machines (template-editor, generation-flow).

## React adapter (`packages/react-ui/`) (planned)

TODO — hooks + render-props. No CSS in package. Controlled-only patterns (no internal state). Why we don't ship Vue/Svelte: API stability of `@doccop/headless` is the community contract.

## Cross-cutting

### Error handling
TODO — `DocCopError` hierarchy, `code` as i18n key, `details` as parameter bag. HTTP status mapping.

### Concurrency model
TODO — engine reentrancy. Per-user rate limiter as the only stateful component in `@doccop/server`.

### Observability
TODO — `Logger` injection contract. Lifecycle log points.

### Versioning and compatibility
TODO — public API surface set, api-extractor as the mechanical guard. Migration guide template.
