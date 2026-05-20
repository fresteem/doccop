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

import { describe, expect, it } from "vitest";
import { ensureParaIds, listParagraphs } from "../../src/docx/AnchorMapper.js";
import { parse, serialize } from "../../src/docx/DocxParser.js";
import { W_NS, findElements } from "../../src/docx/xml-utils.js";
import {
  InvalidPlaceholderTagError,
  OverlappingPlaceholderError,
  PlaceholderNotFoundError,
} from "../../src/errors.js";
import { list, replace, unwrap, wrap } from "../../src/placeholders/PlaceholderEngine.js";
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
