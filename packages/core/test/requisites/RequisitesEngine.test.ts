/**
 * End-to-end integration of the requisites pipeline.
 *
 * The fixture builder doesn't ship a "make a snippet" helper, so these
 * tests build the master + snippet docx archives by hand using PizZip.
 *
 * Coverage:
 * - injectRequisites: snippet content replaces the block SDT in master
 * - injectRequisites: snippet placeholders are resolved in target-party context
 * - injectRequisites: snippet styles are remapped + merged
 * - injectRequisites: snippet numbering is remapped + merged
 * - render: requisites + value placeholders together
 * - render: strict mode throws when no requisitesResolver
 * - render: strict mode throws when snippet missing
 * - render: non-strict mode produces snippet_missing warnings
 */

import { describe, expect, it } from "vitest";
import { ensureParaIds, listParagraphs } from "../../src/docx/AnchorMapper.js";
import { parse, serialize } from "../../src/docx/DocxParser.js";
import { W_NS, findElements } from "../../src/docx/xml-utils.js";
import { AbsentValueInStrictModeError } from "../../src/errors.js";
import { render } from "../../src/render/DocxRenderer.js";
import type { RenderConfig, RenderRequest } from "../../src/render/types.js";
import { injectRequisites, parseAuxiliaryParts } from "../../src/requisites/index.js";
import type { EntityResolver, RequisitesResolver, TemplateSnippet } from "../../src/types.js";

// Workaround: tests import pizzip dynamically for fixture assembly.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PizZip = require("pizzip");

const CONTENT_TYPES = `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const PKG_RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

function buildDocx(parts: {
  documentXml: string;
  stylesXml?: string;
  numberingXml?: string;
}): Uint8Array {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", PKG_RELS);
  zip.file("word/_rels/document.xml.rels", DOC_RELS);
  zip.file("word/document.xml", parts.documentXml);
  if (parts.stylesXml) zip.file("word/styles.xml", parts.stylesXml);
  if (parts.numberingXml) zip.file("word/numbering.xml", parts.numberingXml);
  return zip.generate({ type: "uint8array" });
}

// ── A master with a requisites block SDT ─────────────────────────────────────
function buildMaster(): Uint8Array {
  return buildDocx({
    documentXml: `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="HEAD0001">
      <w:r><w:t xml:space="preserve">Договір з </w:t></w:r>
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_b.full_name"/><w:alias w:val="Контрагент"/></w:sdtPr>
        <w:sdtContent><w:r><w:t>placeholder</w:t></w:r></w:sdtContent>
      </w:sdt>
    </w:p>
    <w:sdt>
      <w:sdtPr>
        <w:tag w:val="requisites:party_b"/>
        <w:alias w:val="Реквізити Б"/>
      </w:sdtPr>
      <w:sdtContent>
        <w:p w14:paraId="MARK0001"><w:r><w:t>[Реквізити Б]</w:t></w:r></w:p>
      </w:sdtContent>
    </w:sdt>
    <w:p w14:paraId="TAIL0001">
      <w:r><w:t>Підпис</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`,
    stylesXml: `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="normal"/></w:style>
</w:styles>`,
  });
}

// ── A snippet with bare-key placeholders + its own style ─────────────────────
function buildSnippet(): Uint8Array {
  return buildDocx({
    documentXml: `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="SNIP0001">
      <w:pPr><w:pStyle w:val="ReqLabel"/></w:pPr>
      <w:r><w:t xml:space="preserve">Назва: </w:t></w:r>
      <w:sdt>
        <w:sdtPr><w:tag w:val="full_name"/><w:alias w:val="Назва"/></w:sdtPr>
        <w:sdtContent><w:r><w:t>placeholder</w:t></w:r></w:sdtContent>
      </w:sdt>
    </w:p>
    <w:p w14:paraId="SNIP0002">
      <w:r><w:t xml:space="preserve">ЄДРПОУ: </w:t></w:r>
      <w:sdt>
        <w:sdtPr><w:tag w:val="edrpou"/><w:alias w:val="EDRPOU"/></w:sdtPr>
        <w:sdtContent><w:r><w:t>placeholder</w:t></w:r></w:sdtContent>
      </w:sdt>
    </w:p>
  </w:body>
</w:document>`,
    stylesXml: `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="ReqLabel">
    <w:name w:val="requisites label"/>
    <w:basedOn w:val="Normal"/>
  </w:style>
</w:styles>`,
  });
}

function staticResolver(
  scope: EntityResolver["scope"],
  values: Record<string, string>,
): EntityResolver {
  return {
    scope,
    async resolve(key) {
      if (key in values) return { kind: "text", value: values[key] as string };
      return { kind: "absent", reason: `no key '${key}'` };
    },
  };
}

function makeSnippet(bytes: Uint8Array, entitySubtype = "TOV"): TemplateSnippet {
  return {
    id: "snippet-1",
    entityType: "organization",
    entitySubtype,
    bytes,
    placeholders: [],
  };
}

function snippetResolver(snippet: TemplateSnippet): RequisitesResolver {
  return {
    async resolveSnippet(entityType, entitySubtype) {
      if (entityType === snippet.entityType && entitySubtype === snippet.entitySubtype)
        return snippet;
      return null;
    },
  };
}

function makeRequest(): RenderRequest {
  return {
    userId: "u1",
    templateId: "tpl",
    templateVersionId: "tpl-v1",
    templateCategory: "TEST",
    documentNumber: "001-2026/TEST",
    parties: [
      { role: "party_a", entityType: "organization", entityId: "a" },
      { role: "party_b", entityType: "organization", entityId: "b" },
    ],
    now: new Date("2026-05-20T00:00:00Z"),
  };
}

describe("injectRequisites — low level", () => {
  it("replaces the block SDT with snippet content and resolves bare-key tags", async () => {
    const master = parse(buildMaster());
    ensureParaIds(master);
    const snippet = makeSnippet(buildSnippet());
    const config: RenderConfig = {
      resolvers: [
        staticResolver("party_b", { full_name: "ACME Ltd", edrpou: "12345678", subtype: "TOV" }),
      ],
    };

    const result = await injectRequisites({
      master,
      tag: "requisites:party_b",
      targetParty: "party_b",
      snippet,
      renderRequest: makeRequest(),
      renderConfig: config,
      stylePrefix: "s1_",
    });

    // The block SDT must be gone, replaced with snippet's two paragraphs.
    const sdtsLeft = findElements(result.document, W_NS, "sdt").length;
    // SDTs left are: the inline party_b.full_name in HEAD + two snippet SDTs that
    // PlaceholderEngine.replace left in place (with resolved content). So 3 total.
    expect(sdtsLeft).toBeGreaterThanOrEqual(1);
    expect(sdtsLeft).toBeLessThanOrEqual(3);

    // Snippet paragraph texts include the resolved values.
    const paragraphs = listParagraphs(result);
    const allText = paragraphs.map((p) => p.element.textContent ?? "").join(" | ");
    expect(allText).toContain("ACME Ltd");
    expect(allText).toContain("12345678");
  });

  it("merges snippet styles into master with a prefix", async () => {
    const master = parse(buildMaster());
    ensureParaIds(master);
    const snippet = makeSnippet(buildSnippet());
    const config: RenderConfig = {
      resolvers: [
        staticResolver("party_b", { full_name: "X", edrpou: "12345678", subtype: "TOV" }),
      ],
    };
    const result = await injectRequisites({
      master,
      tag: "requisites:party_b",
      targetParty: "party_b",
      snippet,
      renderRequest: makeRequest(),
      renderConfig: config,
      stylePrefix: "ABC_",
    });

    const aux = parseAuxiliaryParts(result);
    expect(aux.styles).not.toBeNull();
    const ids = findElements(aux.styles as NonNullable<typeof aux.styles>, W_NS, "style").map((s) =>
      s.getAttributeNS(W_NS, "styleId"),
    );
    expect(ids).toContain("Normal");
    expect(ids).toContain("ABC_ReqLabel");
  });
});

describe("render — requisites integration", () => {
  it("renders a document with both a value SDT and a requisites block", async () => {
    const masterArchive = parse(buildMaster());
    ensureParaIds(masterArchive);
    const snippet = makeSnippet(buildSnippet());
    const config: RenderConfig = {
      resolvers: [
        staticResolver("party_b", { full_name: "ACME Ltd", edrpou: "12345678", subtype: "TOV" }),
      ],
      requisitesResolver: snippetResolver(snippet),
    };
    const result = await render(masterArchive, makeRequest(), config);
    expect(result.warnings).toEqual([]);

    const reparsed = parse(result.docx);
    const allText = listParagraphs(reparsed)
      .map((p) => p.element.textContent ?? "")
      .join(" | ");
    // Both the inline placeholder and snippet content are present.
    expect(allText).toContain("ACME Ltd");
    expect(allText).toContain("12345678");
    expect(allText).toContain("Підпис");
    // The block-marker text is gone.
    expect(allText).not.toContain("[Реквізити Б]");
  });

  it("strict mode throws when no requisitesResolver configured", async () => {
    const masterArchive = parse(buildMaster());
    ensureParaIds(masterArchive);
    const config: RenderConfig = {
      resolvers: [
        staticResolver("party_b", { full_name: "X", edrpou: "12345678", subtype: "TOV" }),
      ],
    };
    await expect(render(masterArchive, makeRequest(), config)).rejects.toBeInstanceOf(
      AbsentValueInStrictModeError,
    );
  });

  it("strict mode throws when snippet for subtype missing", async () => {
    const masterArchive = parse(buildMaster());
    ensureParaIds(masterArchive);
    const snippet = makeSnippet(buildSnippet(), "FOP"); // resolver only serves FOP
    const config: RenderConfig = {
      resolvers: [
        // subtype here is TOV — won't match the FOP-only snippet
        staticResolver("party_b", { full_name: "X", edrpou: "12345678", subtype: "TOV" }),
      ],
      requisitesResolver: snippetResolver(snippet),
    };
    await expect(render(masterArchive, makeRequest(), config)).rejects.toBeInstanceOf(
      AbsentValueInStrictModeError,
    );
  });

  it("non-strict mode produces snippet_missing warning when resolver absent", async () => {
    const masterArchive = parse(buildMaster());
    ensureParaIds(masterArchive);
    const config: RenderConfig = {
      resolvers: [
        staticResolver("party_b", { full_name: "X", edrpou: "12345678", subtype: "TOV" }),
      ],
      options: { strict: false },
    };
    const result = await render(masterArchive, makeRequest(), config);
    expect(result.warnings.some((w) => w.kind === "snippet_missing")).toBe(true);
    // Block SDT remains in output (its text marker still readable).
    const reparsed = parse(result.docx);
    const allText = listParagraphs(reparsed)
      .map((p) => p.element.textContent ?? "")
      .join(" | ");
    expect(allText).toContain("[Реквізити Б]");
  });

  it("rendered output round-trips through DocxParser", async () => {
    const masterArchive = parse(buildMaster());
    ensureParaIds(masterArchive);
    const snippet = makeSnippet(buildSnippet());
    const config: RenderConfig = {
      resolvers: [
        staticResolver("party_b", { full_name: "ACME Ltd", edrpou: "12345678", subtype: "TOV" }),
      ],
      requisitesResolver: snippetResolver(snippet),
    };
    const result = await render(masterArchive, makeRequest(), config);
    // Re-parse and re-serialize — should not throw.
    const reparsed = parse(result.docx);
    const reSerialized = serialize(reparsed);
    expect(reSerialized.length).toBeGreaterThan(0);
  });

  it("renders a requisites block SDT nested inside a <w:tc>", async () => {
    // Master document where the requisites:party_b block SDT lives
    // INSIDE a table cell, not as a top-level body child. The
    // RequisitesEngine must find it (locateBlockSdts uses recursive
    // findElements) and the injected snippet content must land inside
    // the same cell.
    const masterBytes = buildDocx({
      documentXml: `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="HEAD0001"><w:r><w:t>Сторона Б:</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>
          <w:sdt>
            <w:sdtPr>
              <w:tag w:val="requisites:party_b"/>
              <w:alias w:val="Реквізити Б"/>
            </w:sdtPr>
            <w:sdtContent>
              <w:p w14:paraId="MARK0001"><w:r><w:t>[Cell marker]</w:t></w:r></w:p>
            </w:sdtContent>
          </w:sdt>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:p w14:paraId="TAIL0001"><w:r><w:t>Підпис</w:t></w:r></w:p>
  </w:body>
</w:document>`,
      stylesXml: `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="normal"/></w:style>
</w:styles>`,
    });
    const masterArchive = parse(masterBytes);
    ensureParaIds(masterArchive);
    const snippet = makeSnippet(buildSnippet());
    const config: RenderConfig = {
      resolvers: [
        staticResolver("party_b", { full_name: "ACME Ltd", edrpou: "12345678", subtype: "TOV" }),
      ],
      requisitesResolver: snippetResolver(snippet),
    };
    const result = await render(masterArchive, makeRequest(), config);
    expect(result.warnings).toEqual([]);

    const reparsed = parse(result.docx);

    // 1. The block marker is gone — SDT was replaced.
    const allText = listParagraphs(reparsed)
      .map((p) => p.element.textContent ?? "")
      .join(" | ");
    expect(allText).not.toContain("[Cell marker]");
    // 2. The snippet body was substituted with resolved values.
    expect(allText).toContain("ACME Ltd");
    expect(allText).toContain("12345678");
    expect(allText).toContain("Підпис");

    // 3. The injected paragraphs must live INSIDE the <w:tc>, not
    //    lifted up to <w:body>. Walk the tree to confirm.
    const tcNodes = findElements(reparsed.document, W_NS, "tc");
    expect(tcNodes.length).toBe(1);
    const cellText = (tcNodes[0]?.textContent ?? "").replace(/\s+/g, " ");
    expect(cellText).toContain("ACME Ltd");
    expect(cellText).toContain("12345678");

    // 4. No SDT remains under <w:body> or <w:tc> with the requisites tag.
    const remaining = findElements(reparsed.document, W_NS, "sdt").filter((s) => {
      const sdtPr = findElements(s, W_NS, "sdtPr")[0];
      const tagEl = sdtPr ? findElements(sdtPr, W_NS, "tag")[0] : null;
      return tagEl?.getAttributeNS(W_NS, "val") === "requisites:party_b";
    });
    expect(remaining).toHaveLength(0);
  });
});
