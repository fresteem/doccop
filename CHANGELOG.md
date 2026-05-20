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
