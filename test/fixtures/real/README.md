# Real-world `.docx` corpus

This directory holds **Word-authored** `.docx` files used to regression-test the parser, the serializer, and the render pipeline against real-world OOXML quirks. Files in here exist *because no programmatic fixture could reproduce them*.

The corpus is empty at the time of writing. The accompanying test (`packages/core/test/integration/real-corpus.test.ts`) gracefully skips when no files are present, and exercises every file present once any are added.

## What to add

Files that surface OOXML behaviour our `fixtureBuilder` doesn't reproduce:

- Tables with merged cells (vertical and horizontal)
- Nested tables
- Multi-paragraph SDT block contents
- Embedded images, drawings, shapes
- Footnotes, endnotes
- Headers, footers (different per first/odd/even page)
- Complex numbering (multi-level lists with overrides)
- Custom XML parts
- Cyrillic + Latin paragraph mixing
- Track-changes / revisions retained
- Files exported by Word that contain `xml:space="preserve"` in odd places

Source variety matters. Word 365, Word 2021, Word 2019, LibreOffice Writer, Apple Pages, Google Docs all emit subtly different OOXML — collect at least one fixture per source where divergence is observable.

## Layout

```
test/fixtures/real/
├── README.md                       (this file)
├── .gitkeep
├── word-365/
│   ├── 01-merged-cells.docx
│   └── 01-merged-cells.spec.json
├── libreoffice/
│   └── 01-numbering-overrides.docx
│   └── 01-numbering-overrides.spec.json
└── google-docs/
    └── 01-mixed-cyrillic-latin.docx
    └── 01-mixed-cyrillic-latin.spec.json
```

Each `.docx` MUST have a sibling `.spec.json`:

```json
{
  "source": "Word 365 build 16.0.18025",
  "scenario": "one-line description of what makes this file interesting",
  "expectations": ["parse", "roundtrip", "no-warnings"]
}
```

Known `expectations`:

| Key | What the test asserts |
|---|---|
| `"parse"` | `parse(bytes)` does not throw (always tested; key is informational) |
| `"roundtrip"` | `parse(serialize(parse(bytes)))` does not throw (always tested; key is informational) |
| `"no-warnings"` | A non-strict render against a minimal-configured engine returns no warnings |

## Rules

- **Strip PII.** No personal names, addresses, document numbers, embedded comments referencing real people.
- **No copyrighted content.** Replace prose with [Lorem Ipsum](https://lipsum.com/). Replace logos with the doccop placeholder image (TBD — for now leave blank).
- **Strip metadata.** `docProps/core.xml` `creator` / `lastModifiedBy` should be `doccop-corpus` or empty.
- **Size limits.** Each file ≤ 100 KB. Total corpus ≤ 5 MB.
- **License.** All files committed here are MIT-licensed alongside the codebase. Authors implicitly agree to this by opening a PR that adds them.

## Adding a fixture

1. Author or capture the `.docx`. Inspect it manually in Word to confirm the scenario actually reproduces.
2. Strip PII and metadata.
3. Verify size ≤ 100 KB.
4. Write `<file>.spec.json` describing it.
5. Run `npm test -w packages/core` locally — the corpus test must pass against your file.
6. Commit both files in the same PR.

## Source-of-truth for the test runner

The test discovery logic lives in `packages/core/test/integration/real-corpus.test.ts`. If you need different test logic per fixture (e.g. an expected resolved-values map), extend the `.spec.json` schema there.
