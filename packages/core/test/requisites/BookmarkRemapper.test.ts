/**
 * Coverage targets:
 * - start IDs are replaced with fresh ones
 * - matching ends mirror the new IDs
 * - unmatched ends are left alone
 */

import { describe, expect, it } from "vitest";
import { W_NS, findElements, parseXmlSafely } from "../../src/docx/xml-utils.js";
import { remapSnippetBookmarks } from "../../src/requisites/BookmarkRemapper.js";

function parseBody(xml: string) {
  return parseXmlSafely(xml, "document.xml");
}

describe("remapSnippetBookmarks", () => {
  it("rerandomizes paired bookmark IDs", () => {
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p>
      <w:bookmarkStart w:id="1" w:name="alpha"/>
      <w:r><w:t>x</w:t></w:r>
      <w:bookmarkEnd w:id="1"/>
    </w:p>
  </w:body>
</w:document>`);
    const result = remapSnippetBookmarks(body);
    expect(result.idMap.size).toBe(1);
    const newId = result.idMap.get("1");
    expect(newId).toBeDefined();
    expect(newId).not.toBe("1");
    const start = findElements(body, W_NS, "bookmarkStart")[0];
    const end = findElements(body, W_NS, "bookmarkEnd")[0];
    expect(start?.getAttributeNS(W_NS, "id")).toBe(newId);
    expect(end?.getAttributeNS(W_NS, "id")).toBe(newId);
    // name is preserved.
    expect(start?.getAttributeNS(W_NS, "name")).toBe("alpha");
  });

  it("handles multiple bookmarks independently", () => {
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p>
      <w:bookmarkStart w:id="1" w:name="a"/>
      <w:r><w:t>1</w:t></w:r>
      <w:bookmarkEnd w:id="1"/>
      <w:bookmarkStart w:id="2" w:name="b"/>
      <w:r><w:t>2</w:t></w:r>
      <w:bookmarkEnd w:id="2"/>
    </w:p>
  </w:body>
</w:document>`);
    const result = remapSnippetBookmarks(body);
    expect(result.idMap.size).toBe(2);
    expect(result.endsUpdated).toBe(2);
    const newOne = result.idMap.get("1");
    const newTwo = result.idMap.get("2");
    expect(newOne).not.toBe(newTwo);
  });

  it("leaves bookmarkEnd alone when no matching start", () => {
    const body = parseBody(`<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p><w:bookmarkEnd w:id="42"/></w:p>
  </w:body>
</w:document>`);
    const result = remapSnippetBookmarks(body);
    expect(result.endsUpdated).toBe(0);
    expect(findElements(body, W_NS, "bookmarkEnd")[0]?.getAttributeNS(W_NS, "id")).toBe("42");
  });
});
