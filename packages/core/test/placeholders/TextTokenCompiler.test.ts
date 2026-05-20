/**
 * Tests for the plain-text token compiler.
 *
 * Coverage targets:
 * - simple token on its own paragraph → wrapped, rPr preserved
 * - token mid-sentence → run split, middle wrapped
 * - whitespace inside braces → recognised, key trimmed
 * - invalid key → left alone by default; onUnknownKey: "error" throws
 * - idempotency: compile twice → second call no-op
 * - token inside an existing SDT → ignored (no double-wrap)
 * - end-to-end via RequisitesEngine: compiled snippet renders correctly
 */

import type { Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { ensureParaIds } from "../../src/docx/AnchorMapper.js";
import { parse, serialize } from "../../src/docx/DocxParser.js";
import { W_NS, findElements } from "../../src/docx/xml-utils.js";
import { InvalidPlaceholderTagError } from "../../src/errors.js";
import { list } from "../../src/placeholders/PlaceholderEngine.js";
import { compileTextTokens } from "../../src/placeholders/TextTokenCompiler.js";
import type { RenderConfig, RenderRequest } from "../../src/render/types.js";
import { injectRequisites } from "../../src/requisites/index.js";
import type { EntityResolver, TemplateSnippet } from "../../src/types.js";

function buildDocx(documentXml: string): Uint8Array {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
  );
  zip.file("word/document.xml", documentXml);
  return zip.generate({ type: "uint8array" }) as Uint8Array;
}

function wrapDocument(body: string): string {
  return `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>${body}</w:body>
</w:document>`;
}

function buildFixture(body: string) {
  const archive = parse(buildDocx(wrapDocument(body)));
  ensureParaIds(archive);
  return archive;
}

describe("compileTextTokens", () => {
  it("compiles a simple token in a single-run paragraph", () => {
    const archive = buildFixture(
      `<w:p w14:paraId="AAAA0001"><w:r><w:t xml:space="preserve">{{full_name}}</w:t></w:r></w:p>`,
    );
    const { archive: compiled, compiled: tokens, skipped } = compileTextTokens(archive);
    expect(skipped).toEqual([]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.key).toBe("full_name");
    // The SDT is now in the document with the bare-key tag.
    const sdts = findElements(compiled.document, W_NS, "sdt");
    expect(sdts).toHaveLength(1);
    const tagEl = findElements(sdts[0] as Element, W_NS, "tag")[0];
    expect(tagEl?.getAttributeNS(W_NS, "val")).toBe("full_name");
  });

  it("compiles a token in the middle of a sentence (run split)", () => {
    const archive = buildFixture(
      `<w:p w14:paraId="AAAA0002"><w:r><w:t xml:space="preserve">Назва: {{full_name}}, ЄДРПОУ:</w:t></w:r></w:p>`,
    );
    const { archive: compiled, compiled: tokens } = compileTextTokens(archive);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.key).toBe("full_name");
    // The paragraph now contains three structural pieces in order:
    // run("Назва: ") → sdt(full_name) → run(", ЄДРПОУ:").
    // The braces remain inside sdtContent (they get replaced at render
    // time by the resolved value); the surrounding prose splits cleanly.
    const para = findElements(compiled.document, W_NS, "p")[0];
    expect(para).toBeDefined();
    const sdts = findElements(compiled.document, W_NS, "sdt");
    expect(sdts).toHaveLength(1);
    // Direct-child runs of the paragraph carry only the prose halves
    // (the {{full_name}} text is now under sdtContent, not as a direct
    // run of the paragraph).
    const directRuns: Element[] = [];
    for (const child of Array.from((para as Element).childNodes)) {
      if (child.nodeType === 1) {
        const el = child as Element;
        if (el.namespaceURI === W_NS && el.localName === "r") directRuns.push(el);
      }
    }
    expect(directRuns).toHaveLength(2);
    expect(directRuns[0]?.textContent).toBe("Назва: ");
    expect(directRuns[1]?.textContent).toBe(", ЄДРПОУ:");
  });

  it("recognises tokens with whitespace inside the braces", () => {
    const archive = buildFixture(
      `<w:p w14:paraId="AAAA0003"><w:r><w:t xml:space="preserve">{{ edrpou }}</w:t></w:r></w:p>`,
    );
    const { compiled: tokens, skipped } = compileTextTokens(archive);
    expect(skipped).toEqual([]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.key).toBe("edrpou");
  });

  it("leaves invalid keys (uppercase) as plain text by default", () => {
    const archive = buildFixture(
      `<w:p w14:paraId="AAAA0004"><w:r><w:t xml:space="preserve">{{Bad_Key}}</w:t></w:r></w:p>`,
    );
    const { archive: compiled, compiled: tokens } = compileTextTokens(archive);
    expect(tokens).toEqual([]);
    // SDT not created — the {{Bad_Key}} remains as plain text.
    expect(findElements(compiled.document, W_NS, "sdt")).toHaveLength(0);
  });

  it("throws on invalid key when onUnknownKey is 'error'", () => {
    // Use a token shape that the regex captures (lowercase) but custom
    // validateKey rejects. That isolates the onUnknownKey path.
    const archive = buildFixture(
      `<w:p w14:paraId="AAAA0005"><w:r><w:t xml:space="preserve">{{not_allowed}}</w:t></w:r></w:p>`,
    );
    expect(() =>
      compileTextTokens(archive, {
        validateKey: (k) => k !== "not_allowed",
        onUnknownKey: "error",
      }),
    ).toThrow(InvalidPlaceholderTagError);
  });

  it("is idempotent — running twice yields the same archive", () => {
    const archive = buildFixture(
      `<w:p w14:paraId="AAAA0006"><w:r><w:t xml:space="preserve">{{full_name}}</w:t></w:r></w:p>`,
    );
    const pass1 = compileTextTokens(archive);
    const pass2 = compileTextTokens(pass1.archive);
    expect(pass2.compiled).toEqual([]);
    expect(pass2.skipped).toEqual([]);
    // SDT count unchanged.
    expect(findElements(pass2.archive.document, W_NS, "sdt")).toHaveLength(1);
  });

  it("preserves rPr on the wrapped run (bold token survives)", () => {
    const archive = buildFixture(
      `<w:p w14:paraId="AAAA0007"><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{{full_name}}</w:t></w:r></w:p>`,
    );
    const { archive: compiled } = compileTextTokens(archive);
    const sdt = findElements(compiled.document, W_NS, "sdt")[0];
    expect(sdt).toBeDefined();
    const innerRpr = findElements(sdt as Element, W_NS, "rPr")[0];
    expect(innerRpr).toBeDefined();
    expect(findElements(innerRpr as Element, W_NS, "b")).toHaveLength(1);
  });

  it("ignores tokens inside an existing <w:sdt> (idempotency by structure)", () => {
    // The {{full_name}} text lives INSIDE an existing SDT. The compiler
    // walks direct-child runs only, so the inner text is invisible.
    const archive = buildFixture(`
<w:p w14:paraId="AAAA0008">
  <w:sdt>
    <w:sdtPr><w:tag w:val="party_a.name"/><w:alias w:val="Name"/></w:sdtPr>
    <w:sdtContent><w:r><w:t xml:space="preserve">{{full_name}}</w:t></w:r></w:sdtContent>
  </w:sdt>
</w:p>`);
    const { archive: compiled, compiled: tokens } = compileTextTokens(archive);
    expect(tokens).toEqual([]);
    // SDT count unchanged at 1.
    expect(findElements(compiled.document, W_NS, "sdt")).toHaveLength(1);
  });

  it("end-to-end: compiled snippet renders through RequisitesEngine", async () => {
    // Author the snippet as plain-text tokens.
    const snippetBytes = buildDocx(
      wrapDocument(`
<w:p w14:paraId="SNIP0001"><w:r><w:t xml:space="preserve">Назва: {{full_name}}</w:t></w:r></w:p>
<w:p w14:paraId="SNIP0002"><w:r><w:t xml:space="preserve">ЄДРПОУ: {{edrpou}}</w:t></w:r></w:p>`),
    );

    // Compile the snippet — converts {{...}} to bare-key SDTs.
    const snippetArchive = parse(snippetBytes);
    ensureParaIds(snippetArchive);
    const compiledSnippet = compileTextTokens(snippetArchive);
    expect(compiledSnippet.compiled).toHaveLength(2);
    const persistedSnippetBytes = serialize(compiledSnippet.archive);

    // Verify list() with includeBareKey sees them.
    const reparsedSnippet = parse(persistedSnippetBytes);
    const bareKeys = list(reparsedSnippet, new Map(), { includeBareKey: true });
    expect(bareKeys.map((p) => p.key).sort()).toEqual(["edrpou", "full_name"]);

    // Build a master with a requisites:party_a block SDT.
    const masterBytes = buildDocx(
      wrapDocument(`
<w:p w14:paraId="HEAD0001"><w:r><w:t xml:space="preserve">Контракт</w:t></w:r></w:p>
<w:sdt>
  <w:sdtPr><w:tag w:val="requisites:party_a"/><w:alias w:val="Реквізити А"/></w:sdtPr>
  <w:sdtContent><w:p w14:paraId="MARK0001"><w:r><w:t>[marker]</w:t></w:r></w:p></w:sdtContent>
</w:sdt>`),
    );
    const masterArchive = parse(masterBytes);
    ensureParaIds(masterArchive);

    // Run injectRequisites — TagRewriter rewrites {full_name → party_a.full_name},
    // DocxRenderer substitutes values via the party_a resolver.
    const partyA: EntityResolver = {
      scope: "party_a",
      async resolve(key) {
        if (key === "full_name") return { kind: "text", value: "ACME Ltd" };
        if (key === "edrpou") return { kind: "text", value: "12345678" };
        if (key === "subtype") return { kind: "text", value: "TOV" };
        return { kind: "absent", reason: `unknown key ${key}` };
      },
    };
    const snippet: TemplateSnippet = {
      id: "snip-1",
      entityType: "organization",
      entitySubtype: "TOV",
      bytes: persistedSnippetBytes,
      placeholders: [],
    };
    const renderRequest: RenderRequest = {
      userId: "u1",
      templateId: "t1",
      templateVersionId: "v1",
      templateCategory: null,
      documentNumber: "001/2026",
      parties: [{ role: "party_a", entityType: "organization", entityId: "acme" }],
      now: new Date(),
    };
    const renderConfig: RenderConfig = { resolvers: [partyA] };

    const result = await injectRequisites({
      master: masterArchive,
      tag: "requisites:party_a",
      targetParty: "party_a",
      snippet,
      renderRequest,
      renderConfig,
      stylePrefix: "s1_",
    });

    const allText = findElements(result.document, W_NS, "p")
      .map((p) => p.textContent ?? "")
      .join(" | ");
    expect(allText).toContain("ACME Ltd");
    expect(allText).toContain("12345678");
    // The marker is gone.
    expect(allText).not.toContain("[marker]");
  });
});
