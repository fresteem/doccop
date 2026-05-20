/**
 * Tests for the parse/serialize boundary.
 *
 * Coverage targets:
 * - happy path: parse a minimal valid docx, serialize back, re-parse, content survives
 * - resource limit: oversized template rejected before parsing
 * - structural validation: missing word/document.xml rejected
 * - XML validity: malformed document.xml rejected
 * - security: XXE-laden document.xml rejected
 * - passthrough: non-document.xml parts survive byte-for-byte
 */

import { describe, expect, it } from "vitest";
import { parse, serialize } from "../../src/docx/DocxParser.js";
import { W_NS, findElements } from "../../src/docx/xml-utils.js";
import { MalformedDocxError, TemplateTooLargeError, XxeDetectedError } from "../../src/errors.js";
import { buildDocxFixture } from "../fixtures/fixtureBuilder.js";

describe("DocxParser.parse / serialize", () => {
  it("round-trips a minimal document", () => {
    const bytes = buildDocxFixture({
      paragraphs: [{ text: "Hello, doccop" }],
    });
    const archive = parse(bytes);
    expect(archive.document).toBeDefined();
    expect(archive.rawParts.has("[Content_Types].xml")).toBe(true);
    expect(archive.rawParts.has("word/styles.xml")).toBe(true);

    const re = serialize(archive);
    const reparsed = parse(re);
    const paras = findElements(reparsed.document, W_NS, "p");
    expect(paras.length).toBe(1);
    // Text node survives.
    expect(paras[0]?.textContent).toContain("Hello, doccop");
  });

  it("preserves multiple paragraphs in document order", () => {
    const bytes = buildDocxFixture({
      paragraphs: [{ text: "First" }, { text: "Second", bold: true }, { text: "Third" }],
    });
    const archive = parse(bytes);
    const paras = findElements(archive.document, W_NS, "p");
    expect(paras.length).toBe(3);
    expect(paras[0]?.textContent?.trim()).toBe("First");
    expect(paras[1]?.textContent?.trim()).toBe("Second");
    expect(paras[2]?.textContent?.trim()).toBe("Third");
  });

  it("includes the table when the fixture builder requests it", () => {
    const bytes = buildDocxFixture({
      paragraphs: [{ text: "Above" }],
      includeTable: true,
    });
    const archive = parse(bytes);
    expect(findElements(archive.document, W_NS, "tbl").length).toBe(1);
    expect(findElements(archive.document, W_NS, "tr").length).toBe(1);
  });

  it("preserves rawParts byte-for-byte across the round-trip", () => {
    const bytes = buildDocxFixture({ paragraphs: [{ text: "x" }] });
    const archive = parse(bytes);
    const stylesBefore = archive.rawParts.get("word/styles.xml");
    expect(stylesBefore).toBeDefined();

    const re = serialize(archive);
    const archive2 = parse(re);
    const stylesAfter = archive2.rawParts.get("word/styles.xml");
    expect(stylesAfter).toBeDefined();
    expect(
      Buffer.from(stylesAfter as Uint8Array).equals(Buffer.from(stylesBefore as Uint8Array)),
    ).toBe(true);
  });

  it("rejects archives larger than the configured limit", () => {
    const bytes = new Uint8Array(2_000_000); // 2 MB of zeros — also not a valid zip
    expect(() => parse(bytes, { maxBytes: 1_000_000 })).toThrow(TemplateTooLargeError);
  });

  it("rejects non-zip input as malformed", () => {
    const bytes = new TextEncoder().encode("this is not a zip file");
    expect(() => parse(bytes)).toThrow(MalformedDocxError);
  });

  it("rejects an archive missing word/document.xml", () => {
    // Build a zip with only [Content_Types].xml and nothing else.
    const PizZip = (require("pizzip") as typeof import("pizzip")).default ?? require("pizzip");
    const zip = new (PizZip as new () => InstanceType<typeof PizZip>)();
    zip.file("[Content_Types].xml", "<Types/>");
    const bytes = zip.generate({ type: "uint8array" });
    expect(() => parse(bytes)).toThrow(/missing word\/document\.xml/);
  });

  it("rejects malformed document.xml", () => {
    const bytes = buildDocxFixture({ paragraphs: [], malformed: true });
    expect(() => parse(bytes)).toThrow(MalformedDocxError);
  });

  it("rejects an XXE-laden document.xml", () => {
    const bytes = buildDocxFixture({
      paragraphs: [{ text: "innocuous" }],
      injectXxe: true,
    });
    expect(() => parse(bytes)).toThrow(XxeDetectedError);
  });
});
