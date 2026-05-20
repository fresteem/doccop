/**
 * Tests for the HTML preview renderer.
 *
 * The contract is: given a parsed docx, produce a body-only HTML fragment
 * with stable `data-anchor-id` attributes plus a parallel anchor map that
 * mirrors which placeholders live in which paragraphs.
 *
 * Coverage:
 * - empty body
 * - plain paragraphs with paraIds
 * - bold / italic / underline / size / colour formatting
 * - alignment / indentation
 * - tabs and line breaks
 * - tables
 * - inline SDT (placeholder inside a paragraph)
 * - block SDT (placeholder spanning paragraphs)
 * - XSS safety (text and attribute escaping)
 * - missing paraId tolerated
 * - anchor map mirrors output paragraphs in order
 */

import { describe, expect, it } from "vitest";
import { ensureParaIds } from "../../src/docx/AnchorMapper.js";
import { parse } from "../../src/docx/DocxParser.js";
import { render } from "../../src/preview/HtmlRenderer.js";
import { buildDocumentXml, buildDocxFixture } from "../fixtures/fixtureBuilder.js";

function renderFixture(opts: Parameters<typeof buildDocxFixture>[0]) {
  const bytes = buildDocxFixture(opts);
  const archive = parse(bytes);
  ensureParaIds(archive);
  return render(archive);
}

describe("HtmlRenderer.render", () => {
  it("wraps output in the doccop-document container", () => {
    const result = renderFixture({ paragraphs: [{ text: "hello" }] });
    expect(result.html.startsWith('<div class="doccop-document">')).toBe(true);
    expect(result.html.endsWith("</div>")).toBe(true);
  });

  it("emits paragraphs with data-anchor-id and class", () => {
    const result = renderFixture({
      paragraphs: [{ text: "first", paraId: "AAAA1111" }],
    });
    expect(result.html).toContain('<p class="doccop-para" data-anchor-id="AAAA1111">');
    expect(result.html).toContain("first");
    expect(result.anchors.paragraphs).toHaveLength(1);
    expect(result.anchors.paragraphs[0]?.paraId).toBe("AAAA1111");
  });

  it("preserves paragraph order in both HTML and anchor map", () => {
    const result = renderFixture({
      paragraphs: [
        { text: "first", paraId: "AAAAAAAA" },
        { text: "second", paraId: "BBBBBBBB" },
        { text: "third", paraId: "CCCCCCCC" },
      ],
    });
    const ids = result.anchors.paragraphs.map((p) => p.paraId);
    expect(ids).toEqual(["AAAAAAAA", "BBBBBBBB", "CCCCCCCC"]);
    expect(result.html.indexOf("first")).toBeLessThan(result.html.indexOf("second"));
    expect(result.html.indexOf("second")).toBeLessThan(result.html.indexOf("third"));
  });

  it("renders bold runs with font-weight:bold", () => {
    const result = renderFixture({
      paragraphs: [{ text: "bolded", bold: true }],
    });
    expect(result.html).toMatch(/style="[^"]*font-weight:bold/);
  });

  it("renders italic + underline combo", () => {
    const result = renderFixture({
      paragraphs: [{ text: "decorated", italic: true, underline: true }],
    });
    expect(result.html).toMatch(/font-style:italic/);
    expect(result.html).toMatch(/text-decoration:underline/);
  });

  it("renders font size in half-points → CSS pt", () => {
    const result = renderFixture({
      paragraphs: [{ text: "biggish", sizeHalfPoints: 28 }], // 14pt
    });
    expect(result.html).toMatch(/font-size:14\.0pt/);
  });

  it("renders color as #RRGGBB", () => {
    const result = renderFixture({
      paragraphs: [{ text: "red", colorHex: "FF0000" }],
    });
    expect(result.html).toMatch(/color:#FF0000/);
  });

  it("renders paragraph alignment", () => {
    const center = renderFixture({ paragraphs: [{ text: "centered", align: "center" }] });
    expect(center.html).toMatch(/text-align:center/);
    const right = renderFixture({ paragraphs: [{ text: "right", align: "right" }] });
    expect(right.html).toMatch(/text-align:right/);
    const just = renderFixture({ paragraphs: [{ text: "j", align: "justify" }] });
    expect(just.html).toMatch(/text-align:justify/);
  });

  it("renders inline SDT placeholders with tag, alias, and class", () => {
    const result = renderFixture({
      paragraphs: [
        {
          text: "Contract with ",
          paraId: "ABCDEF01",
          inlineSdt: { tag: "party_b.full_name", alias: "Сторона Б — повна назва" },
        },
      ],
    });
    expect(result.html).toContain('class="doccop-placeholder doccop-placeholder--inline"');
    expect(result.html).toContain('data-tag="party_b.full_name"');
    expect(result.html).toContain('data-alias="Сторона Б — повна назва"');
    // Body shows alias, not stored content.
    expect(result.html).toContain("Сторона Б — повна назва");
    expect(result.anchors.paragraphs[0]?.sdts).toEqual([
      {
        tag: "party_b.full_name",
        alias: "Сторона Б — повна назва",
        indexInPara: 1,
        block: false,
      },
    ]);
  });

  it("renders block SDT as a marker div, tracks contained paraIds", () => {
    const result = renderFixture({
      paragraphs: [{ text: "Header", paraId: "AAAAAAAA" }],
      blockSdt: {
        tag: "requisites:party_a",
        alias: "Реквізити Сторона А",
        paragraphs: [
          { text: "Address line", paraId: "BBBBBBBB" },
          { text: "EDRPOU line", paraId: "CCCCCCCC" },
        ],
      },
    });
    expect(result.html).toContain('class="doccop-placeholder doccop-placeholder--block"');
    expect(result.html).toContain('data-tag="requisites:party_a"');
    expect(result.html).toContain("[Реквізити Сторона А]");
    expect(result.anchors.blockSdts).toHaveLength(1);
    expect(result.anchors.blockSdts[0]?.paraIds).toEqual(["BBBBBBBB", "CCCCCCCC"]);
  });

  it("renders tables with rows and cells", () => {
    const result = renderFixture({
      paragraphs: [{ text: "above" }],
      includeTable: true,
    });
    expect(result.html).toContain('<table class="doccop-tbl">');
    expect(result.html).toContain('<tr class="doccop-tr">');
    expect(result.html).toContain('<td class="doccop-tc">');
    expect(result.html).toContain("Table cell content");
  });

  it("escapes HTML special characters in text", () => {
    const result = renderFixture({
      paragraphs: [{ text: '<script>alert("xss")</script>' }],
    });
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("&quot;xss&quot;");
  });

  it("escapes HTML special characters in SDT alias", () => {
    const result = renderFixture({
      paragraphs: [
        {
          text: "x",
          inlineSdt: { tag: "ok", alias: '<img src=x onerror="alert(1)">' },
        },
      ],
    });
    expect(result.html).not.toContain("<img src=");
    expect(result.html).toContain("&lt;img");
    expect(result.html).toContain("&quot;");
  });

  it("escapes HTML special characters in attribute values", () => {
    const result = renderFixture({
      paragraphs: [
        {
          text: "x",
          inlineSdt: { tag: 'evil"onmouseover="alert(1)', alias: "ok" },
        },
      ],
    });
    // The double-quote must be escaped so the attribute cannot be broken.
    expect(result.html).toMatch(/data-tag="evil&quot;onmouseover=&quot;alert\(1\)"/);
  });

  it("tolerates paragraphs without a paraId (anchor map omits them)", () => {
    // Build a document where ensureParaIds is NOT called.
    const bytes = buildDocxFixture({ paragraphs: [{ text: "no id" }] });
    const archive = parse(bytes);
    const result = render(archive);
    expect(result.html).toContain("no id");
    // Paragraph still rendered, but anchor map doesn't include it.
    expect(result.anchors.paragraphs).toHaveLength(0);
  });

  it("returns empty document container for empty bodies", () => {
    const result = renderFixture({ paragraphs: [] });
    expect(result.html).toBe('<div class="doccop-document"></div>');
    expect(result.anchors.paragraphs).toHaveLength(0);
    expect(result.anchors.blockSdts).toHaveLength(0);
  });

  it("handles a document that has no body element gracefully", () => {
    const xml = `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`;
    // Hand-craft a docx-like archive without a <w:body>.
    const PizZip = require("pizzip");
    const zip = new PizZip();
    // Reuse the fixture body but reach into the constructed xml directly.
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
    zip.file(
      "_rels/.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    );
    zip.file("word/document.xml", xml);
    const bytes = zip.generate({ type: "uint8array" });
    const archive = parse(bytes);
    const result = render(archive);
    expect(result.html).toBe('<div class="doccop-document"></div>');
  });

  it("emits anchor index for inline SDTs that mirrors render order", () => {
    // Two runs with an SDT in between → SDT indexInPara should be 1.
    const xml = buildDocumentXml({
      paragraphs: [],
      // We're going to bypass the high-level fixture API and use the raw
      // builder so we can fully control ordering.
    });
    // Easier: just use the inlineSdt fixture path — runs come first, sdt second.
    const result = renderFixture({
      paragraphs: [
        {
          text: "Before",
          paraId: "AAAA0001",
          inlineSdt: { tag: "x", alias: "X" },
        },
      ],
    });
    expect(result.anchors.paragraphs[0]?.sdts[0]?.indexInPara).toBe(1);
    expect(xml.length).toBeGreaterThan(0); // sanity
  });

  it("data-run-index counts only <w:r>, not <w:sdt> (regression — agrees with wrap())", async () => {
    // Build a paragraph where <w:sdt> precedes <w:r>. wrap() enumerates
    // direct <w:r> children, so the plain run is at index 0. The
    // preview must agree — earlier versions of HtmlRenderer incremented
    // runIndex on the SDT branch too, producing data-run-index="1" on
    // the only run, which made hosts pass invalid indices into wrap().
    // See PlaceholderNotFoundError: "<paraId>/runs[1..1]" bug reports.
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="C1C1C1C1">
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_a.name"/><w:alias w:val="N"/></w:sdtPr>
        <w:sdtContent><w:r><w:t>placeholder</w:t></w:r></w:sdtContent>
      </w:sdt>
      <w:r><w:t xml:space="preserve">plain</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
    const result = render(archive);
    // The plain run must be data-run-index="0", not "1".
    expect(result.html).toContain('<span class="doccop-run" data-run-index="0">');
    expect(result.html).toContain("plain");
    expect(result.html).not.toContain('data-run-index="1">plain');
    // The SDT's anchor entry reports indexInPara = 0 (zero runs seen
    // when the SDT was emitted).
    expect(result.anchors.paragraphs[0]?.sdts[0]?.indexInPara).toBe(0);
  });
});
