/**
 * Coverage targets:
 * - remap: snippet numId offset by master max+1
 * - remap: abstractNumId offset by master max+1
 * - remap: abstractNumId references inside <w:num> get updated
 * - remap: body numId refs get updated
 * - remap: no snippet numbering returns zero counts
 * - merge: appends snippet defs to master
 */

import { describe, expect, it } from "vitest";
import { W_NS, findElements, parseXmlSafely } from "../../src/docx/xml-utils.js";
import {
  mergeNumberingIntoMaster,
  remapSnippetNumbering,
} from "../../src/requisites/NumberingRemapper.js";

function parseNumbering(xml: string) {
  return parseXmlSafely(xml, "numbering.xml");
}
function parseBody(xml: string) {
  return parseXmlSafely(xml, "document.xml");
}

describe("remapSnippetNumbering", () => {
  it("offsets snippet numIds above master's max", () => {
    const masterNum = parseNumbering(`<?xml version="1.0"?>
<w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="0"/>
  <w:abstractNum w:abstractNumId="3"/>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="5"><w:abstractNumId w:val="3"/></w:num>
</w:numbering>`);
    const snippetNum = parseNumbering(`<?xml version="1.0"?>
<w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="0"/>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`);
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}"><w:body><w:p/></w:body></w:document>`);
    const result = remapSnippetNumbering(masterNum, snippetNum, body);
    // master max numId = 5 → offset = 6
    // master max abstractNumId = 3 → offset = 4
    expect(result.numIdMap.get(1)).toBe(7);
    expect(result.abstractNumIdMap.get(0)).toBe(4);

    const snippetNums = findElements(snippetNum, W_NS, "num");
    expect(snippetNums[0]?.getAttributeNS(W_NS, "numId")).toBe("7");
    const innerAbsRef = findElements(snippetNum, W_NS, "abstractNumId").find(
      (el) => el.parentNode === snippetNums[0],
    );
    expect(innerAbsRef?.getAttributeNS(W_NS, "val")).toBe("4");
  });

  it("updates body numId references", () => {
    const snippetNum = parseNumbering(`<?xml version="1.0"?>
<w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="0"/>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`);
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p>
      <w:pPr>
        <w:numPr>
          <w:ilvl w:val="0"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
    </w:p>
  </w:body>
</w:document>`);
    const result = remapSnippetNumbering(null, snippetNum, body);
    expect(result.bodyRefsUpdated).toBe(1);
    expect(findElements(body, W_NS, "numId")[0]?.getAttributeNS(W_NS, "val")).toBe("2");
  });

  it("returns no-op result when snippet has no numbering", () => {
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}"><w:body><w:p/></w:body></w:document>`);
    const result = remapSnippetNumbering(null, null, body);
    expect(result.numIdMap.size).toBe(0);
    expect(result.abstractNumIdMap.size).toBe(0);
    expect(result.bodyRefsUpdated).toBe(0);
  });

  it("uses offset 1 when master has no numbering", () => {
    const snippetNum = parseNumbering(`<?xml version="1.0"?>
<w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="0"/>
  <w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`);
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}"><w:body/></w:document>`);
    const result = remapSnippetNumbering(null, snippetNum, body);
    expect(result.numIdMap.get(2)).toBe(3);
    expect(result.abstractNumIdMap.get(0)).toBe(1);
  });
});

describe("mergeNumberingIntoMaster", () => {
  it("appends snippet defs (abstractNum first, then num)", () => {
    const master = parseNumbering(`<?xml version="1.0"?>
<w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="0"/>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`);
    const snippet = parseNumbering(`<?xml version="1.0"?>
<w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="9"/>
  <w:num w:numId="10"><w:abstractNumId w:val="9"/></w:num>
</w:numbering>`);
    const merged = mergeNumberingIntoMaster(master, snippet);
    expect(merged).not.toBeNull();
    const abIds = findElements(merged as NonNullable<typeof merged>, W_NS, "abstractNum")
      .map((e) => e.getAttributeNS(W_NS, "abstractNumId"))
      .sort();
    expect(abIds).toEqual(["0", "9"]);
    const numIds = findElements(merged as NonNullable<typeof merged>, W_NS, "num")
      .map((e) => e.getAttributeNS(W_NS, "numId"))
      .sort();
    expect(numIds).toEqual(["1", "10"]);
  });

  it("returns master untouched when snippet null", () => {
    const master = parseNumbering(`<?xml version="1.0"?>
<w:numbering xmlns:w="${W_NS}"><w:abstractNum w:abstractNumId="0"/></w:numbering>`);
    expect(mergeNumberingIntoMaster(master, null)).toBe(master);
  });

  it("returns snippet when master null", () => {
    const snippet = parseNumbering(`<?xml version="1.0"?>
<w:numbering xmlns:w="${W_NS}"><w:abstractNum w:abstractNumId="0"/></w:numbering>`);
    expect(mergeNumberingIntoMaster(null, snippet)).toBe(snippet);
  });
});
