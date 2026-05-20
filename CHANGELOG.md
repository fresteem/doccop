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
