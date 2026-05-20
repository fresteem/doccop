/**
 * Programmatic .docx fixture builder for tests.
 *
 * Instead of committing binary .docx fixtures (which would be opaque in
 * code review and tedious to regenerate when we tweak content), we build
 * minimal valid OOXML archives in memory at test time.
 *
 * The output is a real `.docx` byte stream that the DocxParser can
 * round-trip and that Microsoft Word will open. We include only the
 * parts Word *requires* to consider an archive valid: `[Content_Types].xml`,
 * `_rels/.rels`, `word/document.xml`, `word/_rels/document.xml.rels`,
 * and `word/styles.xml`. Numbering, fonts, themes, settings — all
 * optional for our purposes — are omitted.
 */

import PizZip from "pizzip";

/** A single paragraph to include in the fixture document. */
export interface FixtureParagraph {
  text: string;
  /** Pre-set `w14:paraId`. If absent, the fixture omits the attribute so
   *  AnchorMapper has something to do. */
  paraId?: string;
  /** Render the run as bold. */
  bold?: boolean;
  /** Italic run. */
  italic?: boolean;
  /** Underlined run. */
  underline?: boolean;
  /** Font size in half-points (e.g. 24 → 12pt). */
  sizeHalfPoints?: number;
  /** RGB hex (without leading #), e.g. "FF0000". */
  colorHex?: string;
  /** Paragraph alignment. */
  align?: "left" | "center" | "right" | "justify";
  /**
   * Inline SDT to insert after the text run. Renders as a wrapped span
   * with the given tag + alias.
   */
  inlineSdt?: { tag: string; alias: string };
}

/** Options for `buildDocxFixture`. */
export interface FixtureOptions {
  paragraphs: FixtureParagraph[];
  /** When true, append a one-cell table after the paragraphs. */
  includeTable?: boolean;
  /** Inject `<!ENTITY xxe SYSTEM "...">` into the prolog to test XXE rejection. */
  injectXxe?: boolean;
  /** Skip the `<w:document>` element — produces a "missing document.xml" condition
   *  (actually a malformed XML); useful for negative tests. */
  malformed?: boolean;
  /**
   * Append a block-level SDT after the paragraphs. Contains the given
   * paragraph texts as its body.
   */
  blockSdt?: {
    tag: string;
    alias: string;
    paragraphs: Array<{ text: string; paraId?: string }>;
  };
}

/**
 * Build a minimal but valid `.docx` byte stream from the given options.
 */
export function buildDocxFixture(opts: FixtureOptions): Uint8Array {
  const zip = new PizZip();

  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.file("_rels/.rels", PACKAGE_RELS_XML);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS_XML);
  zip.file("word/styles.xml", STYLES_XML);
  zip.file("word/document.xml", buildDocumentXml(opts));

  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

/** Build only the `document.xml` body — exported for direct XML-level testing. */
export function buildDocumentXml(opts: FixtureOptions): string {
  if (opts.malformed) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<w:document xmlns:w="bogus"><not-closed>';
  }

  const prolog = opts.injectXxe
    ? '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n'
    : '<?xml version="1.0" encoding="UTF-8"?>\n';

  const body = opts.paragraphs.map(renderParagraph).join("\n");
  const table = opts.includeTable ? TABLE_XML : "";
  const blockSdt = opts.blockSdt ? renderBlockSdt(opts.blockSdt) : "";

  return `${prolog}<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    ${body}
    ${table}
    ${blockSdt}
  </w:body>
</w:document>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderParagraph(p: FixtureParagraph): string {
  const paraIdAttr = p.paraId ? ` w14:paraId="${p.paraId}"` : "";

  const pPrParts: string[] = [];
  if (p.align) {
    const jcVal = p.align === "justify" ? "both" : p.align;
    pPrParts.push(`<w:jc w:val="${jcVal}"/>`);
  }
  const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join("")}</w:pPr>` : "";

  const rPrParts: string[] = [];
  if (p.bold) rPrParts.push("<w:b/>");
  if (p.italic) rPrParts.push("<w:i/>");
  if (p.underline) rPrParts.push('<w:u w:val="single"/>');
  if (p.sizeHalfPoints) rPrParts.push(`<w:sz w:val="${p.sizeHalfPoints}"/>`);
  if (p.colorHex) rPrParts.push(`<w:color w:val="${p.colorHex}"/>`);
  const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join("")}</w:rPr>` : "";

  const escapedText = escapeXml(p.text);
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${escapedText}</w:t></w:r>`;

  const sdt = p.inlineSdt ? renderInlineSdt(p.inlineSdt) : "";

  return `<w:p${paraIdAttr}>${pPr}${run}${sdt}</w:p>`;
}

function renderInlineSdt(s: { tag: string; alias: string }): string {
  return `<w:sdt>
    <w:sdtPr>
      <w:tag w:val="${escapeXml(s.tag)}"/>
      <w:alias w:val="${escapeXml(s.alias)}"/>
    </w:sdtPr>
    <w:sdtContent>
      <w:r><w:t xml:space="preserve">${escapeXml(s.alias)}</w:t></w:r>
    </w:sdtContent>
  </w:sdt>`;
}

function renderBlockSdt(s: {
  tag: string;
  alias: string;
  paragraphs: Array<{ text: string; paraId?: string }>;
}): string {
  const inner = s.paragraphs
    .map(
      (p) =>
        `<w:p${p.paraId ? ` w14:paraId="${p.paraId}"` : ""}><w:r><w:t xml:space="preserve">${escapeXml(p.text)}</w:t></w:r></w:p>`,
    )
    .join("");
  return `<w:sdt>
    <w:sdtPr>
      <w:tag w:val="${escapeXml(s.tag)}"/>
      <w:alias w:val="${escapeXml(s.alias)}"/>
    </w:sdtPr>
    <w:sdtContent>${inner}</w:sdtContent>
  </w:sdt>`;
}

// ─── Constant fixture parts (verbatim, byte-stable) ─────────────────────────

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const PACKAGE_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
</w:styles>`;

const TABLE_XML = `<w:tbl>
  <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>
  <w:tr>
    <w:tc>
      <w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>
      <w:p><w:r><w:t>Table cell content</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
</w:tbl>`;
