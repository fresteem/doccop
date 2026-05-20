/**
 * Coverage targets:
 * - remap: snippet style IDs get the prefix
 * - remap: intra-styles cross-refs (basedOn/next/link) get updated
 * - remap: body pStyle/rStyle refs get updated
 * - remap: body refs to master-only styles are left alone
 * - merge: snippet styles append to master root
 * - merge: missing master returns snippet
 * - merge: missing snippet returns master untouched
 */

import { describe, expect, it } from "vitest";
import { W_NS, findElements, parseXmlSafely } from "../../src/docx/xml-utils.js";
import { mergeStylesIntoMaster, remapSnippetStyles } from "../../src/requisites/StyleRemapper.js";

function parseStyles(xml: string) {
  return parseXmlSafely(xml, "styles.xml");
}
function parseBody(xml: string) {
  return parseXmlSafely(xml, "document.xml");
}

describe("remapSnippetStyles", () => {
  it("prefixes every style id", () => {
    const styles = parseStyles(`<?xml version="1.0"?>
<w:styles xmlns:w="${W_NS}">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="character" w:styleId="Emphasis"><w:name w:val="emphasis"/></w:style>
</w:styles>`);
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}"><w:body><w:p/></w:body></w:document>`);
    const result = remapSnippetStyles(styles, body, "s1_");
    expect(result.idMap.get("Heading1")).toBe("s1_Heading1");
    expect(result.idMap.get("Emphasis")).toBe("s1_Emphasis");
    const ids = findElements(styles, W_NS, "style")
      .map((s) => s.getAttributeNS(W_NS, "styleId"))
      .sort();
    expect(ids).toEqual(["s1_Emphasis", "s1_Heading1"]);
  });

  it("updates intra-styles cross references", () => {
    const styles = parseStyles(`<?xml version="1.0"?>
<w:styles xmlns:w="${W_NS}">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="normal"/>
  </w:style>
</w:styles>`);
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}"><w:body><w:p/></w:body></w:document>`);
    remapSnippetStyles(styles, body, "x_");
    const basedOn = findElements(styles, W_NS, "basedOn")[0];
    const next = findElements(styles, W_NS, "next")[0];
    expect(basedOn?.getAttributeNS(W_NS, "val")).toBe("x_Normal");
    expect(next?.getAttributeNS(W_NS, "val")).toBe("x_Normal");
  });

  it("updates body pStyle and rStyle refs", () => {
    const styles = parseStyles(`<?xml version="1.0"?>
<w:styles xmlns:w="${W_NS}">
  <w:style w:type="paragraph" w:styleId="Quote"/>
  <w:style w:type="character" w:styleId="Strong"/>
</w:styles>`);
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Quote"/></w:pPr>
      <w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>text</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`);
    const result = remapSnippetStyles(styles, body, "q_");
    expect(result.bodyRefsUpdated).toBe(2);
    expect(findElements(body, W_NS, "pStyle")[0]?.getAttributeNS(W_NS, "val")).toBe("q_Quote");
    expect(findElements(body, W_NS, "rStyle")[0]?.getAttributeNS(W_NS, "val")).toBe("q_Strong");
  });

  it("leaves body refs to master-only styles alone", () => {
    const styles = parseStyles(`<?xml version="1.0"?>
<w:styles xmlns:w="${W_NS}">
  <w:style w:type="paragraph" w:styleId="OnlyInSnippet"/>
</w:styles>`);
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p>
  </w:body>
</w:document>`);
    remapSnippetStyles(styles, body, "z_");
    // "Normal" is not in the snippet's style list, so it's left alone —
    // it will continue to resolve against the master's styles.
    expect(findElements(body, W_NS, "pStyle")[0]?.getAttributeNS(W_NS, "val")).toBe("Normal");
  });

  it("returns no-op result when snippet has no styles", () => {
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}"><w:body><w:p/></w:body></w:document>`);
    const result = remapSnippetStyles(null, body, "q_");
    expect(result.idMap.size).toBe(0);
    expect(result.bodyRefsUpdated).toBe(0);
  });
});

describe("mergeStylesIntoMaster", () => {
  it("appends snippet styles to master root", () => {
    const master = parseStyles(`<?xml version="1.0"?>
<w:styles xmlns:w="${W_NS}">
  <w:style w:styleId="MasterOne"/>
</w:styles>`);
    const snippet = parseStyles(`<?xml version="1.0"?>
<w:styles xmlns:w="${W_NS}">
  <w:style w:styleId="s_SnippetOne"/>
  <w:style w:styleId="s_SnippetTwo"/>
</w:styles>`);
    const merged = mergeStylesIntoMaster(master, snippet);
    expect(merged).not.toBeNull();
    const ids = findElements(merged as NonNullable<typeof merged>, W_NS, "style")
      .map((s) => s.getAttributeNS(W_NS, "styleId"))
      .sort();
    expect(ids).toEqual(["MasterOne", "s_SnippetOne", "s_SnippetTwo"]);
  });

  it("returns snippet when master is null", () => {
    const snippet = parseStyles(`<?xml version="1.0"?>
<w:styles xmlns:w="${W_NS}"><w:style w:styleId="X"/></w:styles>`);
    const merged = mergeStylesIntoMaster(null, snippet);
    expect(merged).toBe(snippet);
  });

  it("returns master when snippet is null", () => {
    const master = parseStyles(`<?xml version="1.0"?>
<w:styles xmlns:w="${W_NS}"><w:style w:styleId="Y"/></w:styles>`);
    const merged = mergeStylesIntoMaster(master, null);
    expect(merged).toBe(master);
  });
});
