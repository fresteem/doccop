/**
 * End-to-end tests for the placeholder editing engine.
 *
 * Coverage:
 * - list() returns no placeholders for a fresh document
 * - list() finds inline and block SDTs
 * - wrap() inserts an SDT around a whole-run selection
 * - wrap() splits a run when offset > 0 / < text length
 * - wrap() handles same-run mid-mid selections (three pieces)
 * - wrap() handles cross-run selections
 * - wrap() rejects overlapping selections
 * - wrap() rejects invalid tag / alias
 * - wrap() rejects empty selections
 * - wrap() rejects unknown paraId
 * - wrap() does not mutate the input archive
 * - wrap() round-trips through DocxParser
 * - unwrap() removes the SDT and restores content
 * - unwrap() throws for unknown tags
 * - replace() substitutes content
 * - replace() touches multiple SDTs with the same tag
 * - replace() throws for unknown tags
 */

import type { Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { ensureParaIds, listParagraphs } from "../../src/docx/AnchorMapper.js";
import { parse, serialize } from "../../src/docx/DocxParser.js";
import { W_NS, findElements } from "../../src/docx/xml-utils.js";
import {
  InvalidPlaceholderTagError,
  OverlappingPlaceholderError,
  PlaceholderNotFoundError,
} from "../../src/errors.js";
import {
  list,
  replace,
  unwrap,
  wrap,
  wrapBareKey,
  wrapBlock,
} from "../../src/placeholders/PlaceholderEngine.js";
import { buildDocxFixture } from "../fixtures/fixtureBuilder.js";

function setup(opts: Parameters<typeof buildDocxFixture>[0]) {
  const bytes = buildDocxFixture(opts);
  const archive = parse(bytes);
  ensureParaIds(archive);
  return archive;
}

function paragraphTextById(archive: ReturnType<typeof setup>, paraId: string): string {
  const para = listParagraphs(archive).find((p) => p.paraId === paraId)?.element;
  return para ? (para.textContent ?? "").trim() : "";
}

describe("list", () => {
  it("returns an empty array for a document with no SDTs", () => {
    const archive = setup({ paragraphs: [{ text: "plain" }] });
    expect(list(archive)).toEqual([]);
  });

  it("finds inline SDTs", () => {
    const archive = setup({
      paragraphs: [
        {
          text: "Contract with ",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_b.full_name", alias: "Сторона Б" },
        },
      ],
    });
    const found = list(archive);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      tag: "party_b.full_name",
      alias: "Сторона Б",
      scope: "party_b",
      key: "full_name",
      paraId: "AAAAAAAA",
    });
  });

  it("finds block SDTs", () => {
    const archive = setup({
      paragraphs: [{ text: "Heading", paraId: "11111111" }],
      blockSdt: {
        tag: "requisites:party_a",
        alias: "Реквізити",
        paragraphs: [{ text: "Address", paraId: "22222222" }],
      },
    });
    const found = list(archive);
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("requisites:party_a");
    expect(found[0]?.paraId).toBe("22222222");
  });

  it("skips SDTs whose tag doesn't match the engine's format", () => {
    // Build a docx with an SDT that has an empty tag.
    const archive = setup({
      paragraphs: [
        {
          text: "X",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "", alias: "broken" },
        },
      ],
    });
    expect(list(archive)).toEqual([]);
  });

  it("respects supplied dataType map", () => {
    const archive = setup({
      paragraphs: [
        {
          text: "X",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.edrpou", alias: "EDRPOU" },
        },
      ],
    });
    const types = new Map<string, ReturnType<typeof list>[0]["dataType"]>([
      ["party_a.edrpou", "edrpou"],
    ]);
    expect(list(archive, types)[0]?.dataType).toBe("edrpou");
  });
});

describe("wrap — happy paths", () => {
  it("wraps a whole single run", () => {
    const archive = setup({
      paragraphs: [{ text: "ABC", paraId: "AAAAAAAA" }],
    });
    const next = wrap(
      archive,
      { paraId: "AAAAAAAA", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 3 },
      { tag: "party_a.full_name", alias: "Сторона А", dataType: "text" },
    );
    const found = list(next);
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("party_a.full_name");

    // Original archive untouched.
    expect(list(archive)).toEqual([]);
  });

  it("splits at startOffset > 0 (right half wrapped)", () => {
    const archive = setup({
      paragraphs: [{ text: "ABC Company", paraId: "AAAAAAAA" }],
    });
    const next = wrap(
      archive,
      { paraId: "AAAAAAAA", startRunIndex: 0, startOffset: 4, endRunIndex: 0, endOffset: 11 },
      { tag: "party_a.full_name", alias: "X", dataType: "text" },
    );
    // Paragraph text remains the same.
    expect(paragraphTextById(next, "AAAAAAAA")).toContain("ABC");
    expect(paragraphTextById(next, "AAAAAAAA")).toContain("Company");
  });

  it("splits at endOffset < text length (left half wrapped)", () => {
    const archive = setup({
      paragraphs: [{ text: "ABC Company", paraId: "AAAAAAAA" }],
    });
    const next = wrap(
      archive,
      { paraId: "AAAAAAAA", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 3 },
      { tag: "party_a.full_name", alias: "X", dataType: "text" },
    );
    expect(paragraphTextById(next, "AAAAAAAA")).toContain("ABC");
    expect(paragraphTextById(next, "AAAAAAAA")).toContain("Company");
  });

  it("handles mid-mid same-run selection (three pieces)", () => {
    const archive = setup({
      paragraphs: [{ text: "ABC Company Ltd", paraId: "AAAAAAAA" }],
    });
    const next = wrap(
      archive,
      { paraId: "AAAAAAAA", startRunIndex: 0, startOffset: 4, endRunIndex: 0, endOffset: 11 },
      { tag: "party_a.full_name", alias: "X", dataType: "text" },
    );
    // After wrap, paragraph should have 3 direct-children groups: run "ABC ",
    // sdt wrapping "Company", run " Ltd".
    const found = list(next);
    expect(found).toHaveLength(1);

    // Verify whole text reads correctly.
    const text = paragraphTextById(next, "AAAAAAAA");
    expect(text.replace(/\s+/g, " ").trim()).toBe("ABC Company Ltd");
  });

  it("round-trips through DocxParser unchanged in semantics", () => {
    const archive = setup({
      paragraphs: [{ text: "Hello world", paraId: "AAAAAAAA" }],
    });
    const wrapped = wrap(
      archive,
      { paraId: "AAAAAAAA", startRunIndex: 0, startOffset: 6, endRunIndex: 0, endOffset: 11 },
      { tag: "party_b.full_name", alias: "Б", dataType: "text" },
    );
    const bytes = serialize(wrapped);
    const reparsed = parse(bytes);
    const found = list(reparsed);
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("party_b.full_name");
  });
});

describe("wrap — rejections", () => {
  it("rejects invalid tag", () => {
    const archive = setup({ paragraphs: [{ text: "X", paraId: "AAAAAAAA" }] });
    expect(() =>
      wrap(
        archive,
        { paraId: "AAAAAAAA", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 1 },
        { tag: "BAD TAG", alias: "a", dataType: "text" },
      ),
    ).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects empty alias", () => {
    const archive = setup({ paragraphs: [{ text: "X", paraId: "AAAAAAAA" }] });
    expect(() =>
      wrap(
        archive,
        { paraId: "AAAAAAAA", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 1 },
        { tag: "party_a.k", alias: "", dataType: "text" },
      ),
    ).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects empty selection (start === end)", () => {
    const archive = setup({ paragraphs: [{ text: "X", paraId: "AAAAAAAA" }] });
    expect(() =>
      wrap(
        archive,
        { paraId: "AAAAAAAA", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 0 },
        { tag: "party_a.k", alias: "a", dataType: "text" },
      ),
    ).toThrow(/empty selection/);
  });

  it("rejects unknown paraId", () => {
    const archive = setup({ paragraphs: [{ text: "X", paraId: "AAAAAAAA" }] });
    expect(() =>
      wrap(
        archive,
        { paraId: "FFFFFFFF", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 1 },
        { tag: "party_a.k", alias: "a", dataType: "text" },
      ),
    ).toThrow(PlaceholderNotFoundError);
  });

  it("rejects out-of-range run index", () => {
    const archive = setup({ paragraphs: [{ text: "X", paraId: "AAAAAAAA" }] });
    expect(() =>
      wrap(
        archive,
        { paraId: "AAAAAAAA", startRunIndex: 5, startOffset: 0, endRunIndex: 5, endOffset: 1 },
        { tag: "party_a.k", alias: "a", dataType: "text" },
      ),
    ).toThrow(PlaceholderNotFoundError);
  });

  it("rejects selection that overlaps an existing SDT", () => {
    const archive = setup({
      paragraphs: [
        {
          text: "Hello ",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.existing", alias: "X" },
        },
      ],
    });
    // Paragraph now has: <w:r>"Hello "</w:r><w:sdt>...</w:sdt>
    // The SDT is between runs — wrap range that spans it.
    // We have one run only ("Hello "); there's no second run to extend
    // to, so simulate by mocking a longer paragraph: two runs with
    // SDT between them.
    // Use a different fixture variant: paragraph with two runs is not
    // directly supported, so just verify the guard via second test.
    expect(list(archive)).toHaveLength(1);
    // (Coverage of the explicit overlap branch is provided by the
    //  fixture below with two paragraph runs.)
  });
});

describe("unwrap", () => {
  it("removes an inline SDT and restores its content", () => {
    const archive = setup({
      paragraphs: [
        {
          text: "Hello ",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.target", alias: "T" },
        },
      ],
    });
    expect(list(archive)).toHaveLength(1);
    const next = unwrap(archive, "party_a.target");
    expect(list(next)).toHaveLength(0);
    // Original archive untouched.
    expect(list(archive)).toHaveLength(1);
  });

  it("throws for unknown tag", () => {
    const archive = setup({ paragraphs: [{ text: "X" }] });
    expect(() => unwrap(archive, "no.such")).toThrow(PlaceholderNotFoundError);
  });

  it("removes a block SDT", () => {
    const archive = setup({
      paragraphs: [{ text: "Heading", paraId: "11111111" }],
      blockSdt: {
        tag: "requisites:party_a",
        alias: "R",
        paragraphs: [{ text: "Address", paraId: "22222222" }],
      },
    });
    const next = unwrap(archive, "requisites:party_a");
    expect(list(next)).toHaveLength(0);
    // Contained paragraph survives at the top level.
    const ids = listParagraphs(next).map((p) => p.paraId);
    expect(ids).toContain("22222222");
  });
});

describe("replace", () => {
  it("substitutes content with a single text value", () => {
    const archive = setup({
      paragraphs: [
        {
          text: "Hello ",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.full_name", alias: "X" },
        },
      ],
    });
    const next = replace(archive, "party_a.full_name", "ACME Ltd");
    const text = paragraphTextById(next, "AAAAAAAA");
    expect(text).toContain("ACME Ltd");
    // Original is unchanged.
    expect(paragraphTextById(archive, "AAAAAAAA")).not.toContain("ACME Ltd");
  });

  it("preserves the SDT wrapper after replace", () => {
    const archive = setup({
      paragraphs: [
        {
          text: "X",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.full_name", alias: "X" },
        },
      ],
    });
    const next = replace(archive, "party_a.full_name", "ACME");
    // SDT still discoverable by list().
    expect(list(next)).toHaveLength(1);
  });

  it("throws for unknown tag", () => {
    const archive = setup({ paragraphs: [{ text: "X" }] });
    expect(() => replace(archive, "no.such", "value")).toThrow(PlaceholderNotFoundError);
  });

  it("preserves xml:space on the substituted text", () => {
    const archive = setup({
      paragraphs: [
        {
          text: "X",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.k", alias: "X" },
        },
      ],
    });
    const next = replace(archive, "party_a.k", "  trimmed  ");
    const bytes = serialize(next);
    const reparsed = parse(bytes);
    const ts = findElements(reparsed.document, W_NS, "t");
    const hasSpacePreserve = ts.some(
      (t) =>
        t.getAttribute("xml:space") === "preserve" && (t.textContent ?? "").includes("  trimmed  "),
    );
    expect(hasSpacePreserve).toBe(true);
  });
});

describe("overlap guard with two-run paragraphs", () => {
  it("rejects wrap range that crosses an existing SDT (via custom doc)", () => {
    // Build a paragraph that contains <w:r>A</w:r><w:sdt>...</w:sdt><w:r>B</w:r>
    // by leveraging the fixture's inlineSdt for the SDT slot, and a
    // second paragraph isn't enough — we need two runs in one paragraph.
    // Workaround: assemble the document XML by hand and feed through parser.
    const PizZip = require("pizzip");
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="DEADBEEF">
      <w:r><w:t xml:space="preserve">A</w:t></w:r>
      <w:sdt>
        <w:sdtPr>
          <w:tag w:val="party_a.existing"/>
          <w:alias w:val="EX"/>
        </w:sdtPr>
        <w:sdtContent>
          <w:r><w:t>existing</w:t></w:r>
        </w:sdtContent>
      </w:sdt>
      <w:r><w:t xml:space="preserve">B</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;
    const zip = new PizZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    );
    zip.file(
      "_rels/.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    );
    zip.file("word/document.xml", xml);
    const bytes = zip.generate({ type: "uint8array" });
    const archive = parse(bytes);
    ensureParaIds(archive);

    expect(() =>
      wrap(
        archive,
        { paraId: "DEADBEEF", startRunIndex: 0, startOffset: 0, endRunIndex: 1, endOffset: 1 },
        { tag: "party_a.new", alias: "New", dataType: "text" },
      ),
    ).toThrow(OverlappingPlaceholderError);
  });
});

describe("wrapBlock", () => {
  it("wraps a two-paragraph range into a block SDT", () => {
    const archive = setup({
      paragraphs: [
        { text: "Реквізити сторони А:", paraId: "10000001" },
        { text: "ТОВ «ACME»", paraId: "10000002" },
        { text: "Body continues here.", paraId: "10000003" },
      ],
    });
    const next = wrapBlock(
      archive,
      { startParaId: "10000001", endParaId: "10000002" },
      { tag: "requisites:party_a", alias: "Реквізити А", dataType: "text" },
    );
    // The block SDT appears in `list()` as a synthetic placeholder.
    const placeholders = list(next);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]?.tag).toBe("requisites:party_a");
    // Paragraph 10000003 remains a direct child of <w:body>.
    const sdtNodes = findElements(next.document, W_NS, "sdt");
    expect(sdtNodes).toHaveLength(1);
    const sdt = sdtNodes[0];
    expect(sdt).toBeDefined();
    // The 3rd paragraph is NOT inside the SDT.
    const innerParas = findElements(sdt as Element, W_NS, "p").map((p) =>
      p.getAttributeNS("http://schemas.microsoft.com/office/word/2010/wordml", "paraId"),
    );
    expect(innerParas).toEqual(["10000001", "10000002"]);
    // Original archive is untouched.
    expect(list(archive)).toHaveLength(0);
  });

  it("wraps a single-paragraph block (start === end)", () => {
    const archive = setup({
      paragraphs: [
        { text: "Single para body", paraId: "20000001" },
        { text: "Tail", paraId: "20000002" },
      ],
    });
    const next = wrapBlock(
      archive,
      { startParaId: "20000001", endParaId: "20000001" },
      { tag: "requisites:party_b", alias: "Реквізити Б", dataType: "text" },
    );
    expect(list(next)).toHaveLength(1);
    const sdt = findElements(next.document, W_NS, "sdt")[0];
    const innerParas = findElements(sdt as Element, W_NS, "p");
    expect(innerParas).toHaveLength(1);
  });

  it("rejects a non-requisites tag", () => {
    const archive = setup({
      paragraphs: [{ text: "Body", paraId: "30000001" }],
    });
    expect(() =>
      wrapBlock(
        archive,
        { startParaId: "30000001", endParaId: "30000001" },
        { tag: "party_a.full_name", alias: "Name", dataType: "text" },
      ),
    ).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects when startParaId is unknown", () => {
    const archive = setup({
      paragraphs: [{ text: "Body", paraId: "40000001" }],
    });
    expect(() =>
      wrapBlock(
        archive,
        { startParaId: "DEADBEEF", endParaId: "40000001" },
        { tag: "requisites:party_a", alias: "R", dataType: "text" },
      ),
    ).toThrow(PlaceholderNotFoundError);
  });

  it("rejects nesting inside an existing requisites:* SDT with OverlappingPlaceholderError", () => {
    // Fixture body: <p:50000001> <p:50000003> <sdt requisites:party_a>(p:50000002)</sdt>
    // Wrap range pointing at the paragraph inside the existing
    // requisites:* SDT must be refused — nesting requisites in
    // requisites is forbidden (RequisitesEngine cannot render it).
    const archive = setup({
      paragraphs: [
        { text: "Before", paraId: "50000001" },
        { text: "After", paraId: "50000003" },
      ],
      blockSdt: {
        tag: "requisites:party_a",
        alias: "Existing",
        paragraphs: [{ text: "Inner", paraId: "50000002" }],
      },
    });
    expect(() =>
      wrapBlock(
        archive,
        { startParaId: "50000002", endParaId: "50000002" },
        { tag: "requisites:party_b", alias: "New", dataType: "text" },
      ),
    ).toThrow(OverlappingPlaceholderError);
  });

  it("survives serialize → parse round-trip via list()", () => {
    const archive = setup({
      paragraphs: [
        { text: "P1", paraId: "60000001" },
        { text: "P2", paraId: "60000002" },
      ],
    });
    const next = wrapBlock(
      archive,
      { startParaId: "60000001", endParaId: "60000002" },
      { tag: "requisites:party_a", alias: "R", dataType: "text" },
    );
    const bytes = serialize(next);
    const reparsed = parse(bytes);
    const placeholders = list(reparsed);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]?.tag).toBe("requisites:party_a");
  });
});

describe("replace — rPr preservation", () => {
  it("preserves <w:b/> from the wrapped run", () => {
    // Build manually: a paragraph with <w:r><w:rPr><w:b/></w:rPr><w:t>...</w:t></w:r>
    // wrapped in an SDT.
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="A0000001">
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_a.name"/><w:alias w:val="N"/></w:sdtPr>
        <w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r></w:sdtContent>
      </w:sdt>
    </w:p>
  </w:body>
</w:document>`;
    const archive = parseDocXmlIntoFixture(xml);
    const next = replace(archive, "party_a.name", "ACME Ltd");
    // The substituted SDT content's run must carry <w:rPr><w:b/></w:rPr>.
    const sdt = findElements(next.document, W_NS, "sdt")[0];
    const newRuns = findElements(sdt as Element, W_NS, "r");
    expect(newRuns).toHaveLength(1);
    const rprs = findElements(newRuns[0] as Element, W_NS, "rPr");
    expect(rprs).toHaveLength(1);
    const bs = findElements(rprs[0] as Element, W_NS, "b");
    expect(bs).toHaveLength(1);
  });

  it("preserves italic + colour", () => {
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="A0000002">
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_a.k"/><w:alias w:val="K"/></w:sdtPr>
        <w:sdtContent><w:r><w:rPr><w:i/><w:color w:val="FF0000"/></w:rPr><w:t>X</w:t></w:r></w:sdtContent>
      </w:sdt>
    </w:p>
  </w:body>
</w:document>`;
    const archive = parseDocXmlIntoFixture(xml);
    const next = replace(archive, "party_a.k", "after");
    const sdt = findElements(next.document, W_NS, "sdt")[0];
    const runs = findElements(sdt as Element, W_NS, "r");
    expect(findElements(runs[0] as Element, W_NS, "i")).toHaveLength(1);
    expect(findElements(runs[0] as Element, W_NS, "color")).toHaveLength(1);
  });

  it("produces a plain run when SDT has no <w:r>", () => {
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="A0000003">
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_a.k"/><w:alias w:val="K"/></w:sdtPr>
        <w:sdtContent></w:sdtContent>
      </w:sdt>
    </w:p>
  </w:body>
</w:document>`;
    const archive = parseDocXmlIntoFixture(xml);
    const next = replace(archive, "party_a.k", "value");
    const sdt = findElements(next.document, W_NS, "sdt")[0];
    const runs = findElements(sdt as Element, W_NS, "r");
    expect(runs).toHaveLength(1);
    // No <w:rPr> on the new run.
    expect(findElements(runs[0] as Element, W_NS, "rPr")).toHaveLength(0);
  });

  it("preserves rPr even when value is empty", () => {
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="A0000004">
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_a.k"/><w:alias w:val="K"/></w:sdtPr>
        <w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>old</w:t></w:r></w:sdtContent>
      </w:sdt>
    </w:p>
  </w:body>
</w:document>`;
    const archive = parseDocXmlIntoFixture(xml);
    const next = replace(archive, "party_a.k", "");
    const sdt = findElements(next.document, W_NS, "sdt")[0];
    const runs = findElements(sdt as Element, W_NS, "r");
    const bs = findElements(runs[0] as Element, W_NS, "b");
    expect(bs).toHaveLength(1);
  });

  it("keeps per-SDT formatting when multiple bindings share a tag", () => {
    // Two SDTs with the same tag: one wrapping bold text, one italic.
    // The current API matches both on `replace` (data-binding pattern).
    // Each preserved rPr should reflect the SDT it was attached to.
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="A0000005">
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_a.k"/><w:alias w:val="K"/></w:sdtPr>
        <w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:sdtContent>
      </w:sdt>
    </w:p>
    <w:p w14:paraId="A0000006">
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_a.k"/><w:alias w:val="K"/></w:sdtPr>
        <w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r></w:sdtContent>
      </w:sdt>
    </w:p>
  </w:body>
</w:document>`;
    const archive = parseDocXmlIntoFixture(xml);
    const next = replace(archive, "party_a.k", "X");
    const sdts = findElements(next.document, W_NS, "sdt");
    expect(sdts).toHaveLength(2);
    const firstRpr = findElements(sdts[0] as Element, W_NS, "rPr")[0];
    const secondRpr = findElements(sdts[1] as Element, W_NS, "rPr")[0];
    expect(findElements(firstRpr as Element, W_NS, "b")).toHaveLength(1);
    expect(findElements(secondRpr as Element, W_NS, "i")).toHaveLength(1);
  });
});

/**
 * Helper: feed a hand-crafted document.xml through the same parse path
 * the rPr-preservation tests need, since fixtureBuilder doesn't expose
 * sdtContent customisation.
 */
function parseDocXmlIntoFixture(xml: string): ReturnType<typeof parse> {
  const PizZip = require("pizzip");
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
  );
  zip.file("word/document.xml", xml);
  const bytes = zip.generate({ type: "uint8array" }) as Uint8Array;
  const archive = parse(bytes);
  ensureParaIds(archive);
  return archive;
}

describe("wrapBlock — non-body containers", () => {
  it("wraps a single paragraph inside a one-cell table; SDT lives inside <w:tc>", () => {
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>
          <w:p w14:paraId="C1000001"><w:r><w:t>Cell para</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
    const archive = parseDocXmlIntoFixture(xml);
    const next = wrapBlock(
      archive,
      { startParaId: "C1000001", endParaId: "C1000001" },
      { tag: "requisites:party_a", alias: "R", dataType: "text" },
    );
    // Exactly one SDT in the document and it lives inside <w:tc>, not <w:body>.
    const sdts = findElements(next.document, W_NS, "sdt");
    expect(sdts).toHaveLength(1);
    const sdt = sdts[0] as Element;
    const parent = sdt.parentNode as Element | null;
    expect(parent).not.toBeNull();
    expect(parent?.localName).toBe("tc");
  });

  it("wraps two adjacent paragraphs inside the same <w:tc>", () => {
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>
          <w:p w14:paraId="C2000001"><w:r><w:t>Cell para A</w:t></w:r></w:p>
          <w:p w14:paraId="C2000002"><w:r><w:t>Cell para B</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
    const archive = parseDocXmlIntoFixture(xml);
    const next = wrapBlock(
      archive,
      { startParaId: "C2000001", endParaId: "C2000002" },
      { tag: "requisites:party_a", alias: "R", dataType: "text" },
    );
    const sdts = findElements(next.document, W_NS, "sdt");
    expect(sdts).toHaveLength(1);
    const sdt = sdts[0] as Element;
    // Both paragraphs are now under sdtContent, and the SDT is in <w:tc>.
    expect((sdt.parentNode as Element).localName).toBe("tc");
    const innerParas = findElements(sdt, W_NS, "p");
    expect(innerParas).toHaveLength(2);
  });

  it("rejects paragraphs that sit in DIFFERENT cells (same-parent rule)", () => {
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
          <w:p w14:paraId="C3000001"><w:r><w:t>Cell A</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
          <w:p w14:paraId="C3000002"><w:r><w:t>Cell B</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
    const archive = parseDocXmlIntoFixture(xml);
    expect(() =>
      wrapBlock(
        archive,
        { startParaId: "C3000001", endParaId: "C3000002" },
        { tag: "requisites:party_a", alias: "R", dataType: "text" },
      ),
    ).toThrow(/must share the same parent/);
  });

  it("regression: paragraph inside <w:body> still works (no behaviour change)", () => {
    const archive = setup({
      paragraphs: [{ text: "Body para", paraId: "B0000001" }],
    });
    const next = wrapBlock(
      archive,
      { startParaId: "B0000001", endParaId: "B0000001" },
      { tag: "requisites:party_a", alias: "R", dataType: "text" },
    );
    const sdts = findElements(next.document, W_NS, "sdt");
    expect(sdts).toHaveLength(1);
    expect((sdts[0]?.parentNode as Element | null)?.localName).toBe("body");
  });

  it("allows wrapping inside a non-requisites block <w:sdtContent>", () => {
    // Outer SDT carries a value-style tag (custom.section). Inner range
    // wraps as a new requisites:party_a block — should succeed because
    // outer is not a requisites:* tag.
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:sdt>
      <w:sdtPr><w:tag w:val="custom.section"/><w:alias w:val="Section"/></w:sdtPr>
      <w:sdtContent>
        <w:p w14:paraId="D1000001"><w:r><w:t>Inner para</w:t></w:r></w:p>
      </w:sdtContent>
    </w:sdt>
  </w:body>
</w:document>`;
    const archive = parseDocXmlIntoFixture(xml);
    const next = wrapBlock(
      archive,
      { startParaId: "D1000001", endParaId: "D1000001" },
      { tag: "requisites:party_a", alias: "R", dataType: "text" },
    );
    // Now there are TWO SDTs: outer custom.section, inner requisites:party_a.
    const sdts = findElements(next.document, W_NS, "sdt");
    expect(sdts.length).toBe(2);
    // The new SDT lives inside the outer sdtContent.
    const requisites = sdts.find((s) => {
      const sdtPr = findElements(s, W_NS, "sdtPr")[0];
      const tagEl = sdtPr ? findElements(sdtPr, W_NS, "tag")[0] : null;
      return tagEl?.getAttributeNS(W_NS, "val") === "requisites:party_a";
    });
    expect(requisites).toBeDefined();
    expect((requisites?.parentNode as Element | null)?.localName).toBe("sdtContent");
  });
});

describe("wrapBareKey (snippet authoring)", () => {
  it("happy path: writes <w:tag w:val='edrpou'> with rPr preserved", () => {
    const archive = setup({
      paragraphs: [{ text: "Edrpou: 12345678", paraId: "AAAA0001", bold: true }],
    });
    const next = wrapBareKey(
      archive,
      { paraId: "AAAA0001", startRunIndex: 0, startOffset: 8, endRunIndex: 0, endOffset: 16 },
      { key: "edrpou", alias: "EDRPOU", dataType: "edrpou" },
    );
    // The SDT carries a bare-key tag (no scope, no dot).
    const sdt = findElements(next.document, W_NS, "sdt")[0];
    expect(sdt).toBeDefined();
    const sdtPr = findElements(sdt as Element, W_NS, "sdtPr")[0];
    const tagEl = findElements(sdtPr as Element, W_NS, "tag")[0];
    expect(tagEl?.getAttributeNS(W_NS, "val")).toBe("edrpou");
    // rPr is preserved on the wrapped run.
    const wrappedRuns = findElements(sdt as Element, W_NS, "r");
    expect(wrappedRuns.length).toBeGreaterThan(0);
    const firstRpr = findElements(wrappedRuns[0] as Element, W_NS, "rPr")[0];
    expect(firstRpr).toBeDefined();
    expect(findElements(firstRpr as Element, W_NS, "b")).toHaveLength(1);
  });

  it("rejects uppercase keys", () => {
    const archive = setup({ paragraphs: [{ text: "X", paraId: "AAAA0002" }] });
    expect(() =>
      wrapBareKey(
        archive,
        { paraId: "AAAA0002", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 1 },
        { key: "Edrpou", alias: "EDRPOU", dataType: "text" },
      ),
    ).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects keys with a dot (would look like a scoped tag)", () => {
    const archive = setup({ paragraphs: [{ text: "X", paraId: "AAAA0003" }] });
    expect(() =>
      wrapBareKey(
        archive,
        { paraId: "AAAA0003", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 1 },
        { key: "party_a.name", alias: "Name", dataType: "text" },
      ),
    ).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects empty keys", () => {
    const archive = setup({ paragraphs: [{ text: "X", paraId: "AAAA0004" }] });
    expect(() =>
      wrapBareKey(
        archive,
        { paraId: "AAAA0004", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 1 },
        { key: "", alias: "A", dataType: "text" },
      ),
    ).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects overlap with an existing SDT (same guard as wrap)", () => {
    // Two-run paragraph with an SDT between them. A wrap range that
    // spans both runs crosses the existing SDT — performInlineWrap's
    // guard (shared with wrap) raises OverlappingPlaceholderError.
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="DEEDBEEF">
      <w:r><w:t xml:space="preserve">A</w:t></w:r>
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_a.existing"/><w:alias w:val="EX"/></w:sdtPr>
        <w:sdtContent><w:r><w:t>existing</w:t></w:r></w:sdtContent>
      </w:sdt>
      <w:r><w:t xml:space="preserve">B</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;
    const archive = parseDocXmlIntoFixture(xml);
    expect(() =>
      wrapBareKey(
        archive,
        { paraId: "DEEDBEEF", startRunIndex: 0, startOffset: 0, endRunIndex: 1, endOffset: 1 },
        { key: "merged", alias: "Merged", dataType: "text" },
      ),
    ).toThrow(OverlappingPlaceholderError);
  });

  it("list() hides bare-key SDTs by default; surfaces them with includeBareKey=true", () => {
    const archive = setup({ paragraphs: [{ text: "EDRPOU value", paraId: "AAAA0006" }] });
    const wrapped = wrapBareKey(
      archive,
      { paraId: "AAAA0006", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 6 },
      { key: "edrpou", alias: "EDRPOU", dataType: "edrpou" },
    );
    // Default: bare-key SDT not surfaced (preserves template-editor behaviour).
    expect(list(wrapped)).toHaveLength(0);
    // Opt-in: surfaced with scope="bareKey", key=tag.
    const withBare = list(wrapped, new Map(), { includeBareKey: true });
    expect(withBare).toHaveLength(1);
    expect(withBare[0]?.scope).toBe("bareKey");
    expect(withBare[0]?.key).toBe("edrpou");
    expect(withBare[0]?.tag).toBe("edrpou");
  });

  it("unwrap removes a bare-key SDT by exact tag match", () => {
    const archive = setup({ paragraphs: [{ text: "value here", paraId: "AAAA0007" }] });
    const wrapped = wrapBareKey(
      archive,
      { paraId: "AAAA0007", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 5 },
      { key: "name", alias: "Name", dataType: "text" },
    );
    expect(findElements(wrapped.document, W_NS, "sdt")).toHaveLength(1);
    const unwrapped = unwrap(wrapped, "name");
    expect(findElements(unwrapped.document, W_NS, "sdt")).toHaveLength(0);
  });

  it("survives serialize → parse → list round-trip with includeBareKey", () => {
    const archive = setup({ paragraphs: [{ text: "Назва компанії", paraId: "AAAA0008" }] });
    const wrapped = wrapBareKey(
      archive,
      { paraId: "AAAA0008", startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 5 },
      { key: "name", alias: "Назва", dataType: "text" },
    );
    const bytes = serialize(wrapped);
    const reparsed = parse(bytes);
    const placeholders = list(reparsed, new Map(), { includeBareKey: true });
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]?.scope).toBe("bareKey");
    expect(placeholders[0]?.tag).toBe("name");
  });
});
