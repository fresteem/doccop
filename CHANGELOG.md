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
