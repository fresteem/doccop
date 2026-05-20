/**
 * Tests for OOXML property → CSS translation.
 *
 * Style mapping is exercised end-to-end by HtmlRenderer tests already;
 * this file isolates the pure functions for fine-grained coverage of
 * edge cases (toggle semantics, malformed values, mixed properties).
 */

import { describe, expect, it } from "vitest";
import { W_NS, findElements, parseXmlSafely } from "../../src/docx/xml-utils.js";
import { paraStyleToCss, runStyleToCss } from "../../src/preview/style-mapper.js";

function parseRPr(xml: string) {
  const doc = parseXmlSafely(`<w:root xmlns:w="${W_NS}">${xml}</w:root>`, "test");
  return findElements(doc, W_NS, "rPr")[0] ?? null;
}

function parsePPr(xml: string) {
  const doc = parseXmlSafely(`<w:root xmlns:w="${W_NS}">${xml}</w:root>`, "test");
  return findElements(doc, W_NS, "pPr")[0] ?? null;
}

describe("runStyleToCss", () => {
  it("returns empty string for null", () => {
    expect(runStyleToCss(null)).toBe("");
  });

  it("returns empty string when no recognised properties are present", () => {
    expect(runStyleToCss(parseRPr("<w:rPr/>"))).toBe("");
  });

  it("emits font-weight:bold for <w:b/>", () => {
    expect(runStyleToCss(parseRPr("<w:rPr><w:b/></w:rPr>"))).toContain("font-weight:bold");
  });

  it('treats <w:b w:val="false"/> as off', () => {
    expect(runStyleToCss(parseRPr('<w:rPr><w:b w:val="false"/></w:rPr>'))).toBe("");
  });

  it('treats <w:b w:val="0"/> as off', () => {
    expect(runStyleToCss(parseRPr('<w:rPr><w:b w:val="0"/></w:rPr>'))).toBe("");
  });

  it("emits font-style:italic for <w:i/>", () => {
    expect(runStyleToCss(parseRPr("<w:rPr><w:i/></w:rPr>"))).toContain("font-style:italic");
  });

  it("emits text-decoration:underline for <w:u w:val=single/>", () => {
    expect(runStyleToCss(parseRPr('<w:rPr><w:u w:val="single"/></w:rPr>'))).toContain(
      "text-decoration:underline",
    );
  });

  it('does NOT emit underline for <w:u w:val="none"/>', () => {
    expect(runStyleToCss(parseRPr('<w:rPr><w:u w:val="none"/></w:rPr>'))).toBe("");
  });

  it("emits text-decoration:line-through for <w:strike/>", () => {
    expect(runStyleToCss(parseRPr("<w:rPr><w:strike/></w:rPr>"))).toContain(
      "text-decoration:line-through",
    );
  });

  it("converts <w:sz w:val=22/> to 11pt", () => {
    expect(runStyleToCss(parseRPr('<w:rPr><w:sz w:val="22"/></w:rPr>'))).toContain(
      "font-size:11.0pt",
    );
  });

  it("ignores malformed sz values", () => {
    expect(runStyleToCss(parseRPr('<w:rPr><w:sz w:val="abc"/></w:rPr>'))).not.toContain(
      "font-size",
    );
  });

  it("ignores out-of-range sz values", () => {
    expect(runStyleToCss(parseRPr('<w:rPr><w:sz w:val="9999"/></w:rPr>'))).not.toContain(
      "font-size",
    );
  });

  it("emits color:#RRGGBB for valid hex", () => {
    expect(runStyleToCss(parseRPr('<w:rPr><w:color w:val="FF8800"/></w:rPr>'))).toContain(
      "color:#FF8800",
    );
  });

  it("ignores invalid hex colors", () => {
    expect(runStyleToCss(parseRPr('<w:rPr><w:color w:val="auto"/></w:rPr>'))).not.toContain(
      "color:",
    );
    expect(runStyleToCss(parseRPr('<w:rPr><w:color w:val="ZZZ"/></w:rPr>'))).not.toContain(
      "color:",
    );
  });

  it("combines multiple properties with semicolons", () => {
    const css = runStyleToCss(parseRPr('<w:rPr><w:b/><w:i/><w:sz w:val="20"/></w:rPr>'));
    expect(css.split(";")).toEqual(["font-weight:bold", "font-style:italic", "font-size:10.0pt"]);
  });
});

describe("paraStyleToCss", () => {
  it("returns empty for null", () => {
    expect(paraStyleToCss(null)).toBe("");
  });

  it('emits text-align:center for <w:jc w:val="center"/>', () => {
    expect(paraStyleToCss(parsePPr('<w:pPr><w:jc w:val="center"/></w:pPr>'))).toContain(
      "text-align:center",
    );
  });

  it('emits text-align:right for "right" and "end"', () => {
    expect(paraStyleToCss(parsePPr('<w:pPr><w:jc w:val="right"/></w:pPr>'))).toContain(
      "text-align:right",
    );
    expect(paraStyleToCss(parsePPr('<w:pPr><w:jc w:val="end"/></w:pPr>'))).toContain(
      "text-align:right",
    );
  });

  it('emits text-align:justify for "both" and "distribute"', () => {
    expect(paraStyleToCss(parsePPr('<w:pPr><w:jc w:val="both"/></w:pPr>'))).toContain(
      "text-align:justify",
    );
    expect(paraStyleToCss(parsePPr('<w:pPr><w:jc w:val="distribute"/></w:pPr>'))).toContain(
      "text-align:justify",
    );
  });

  it("converts indent twips to pt", () => {
    // 720 twips = 36pt = 0.5 inch
    expect(paraStyleToCss(parsePPr('<w:pPr><w:ind w:left="720"/></w:pPr>'))).toContain(
      "margin-left:36.0pt",
    );
  });

  it("accepts <w:ind w:start='...'/> as an alias for left", () => {
    expect(paraStyleToCss(parsePPr('<w:pPr><w:ind w:start="240"/></w:pPr>'))).toContain(
      "margin-left:12.0pt",
    );
  });

  it("ignores malformed indent values", () => {
    expect(paraStyleToCss(parsePPr('<w:pPr><w:ind w:left="abc"/></w:pPr>'))).toBe("");
  });

  it("combines alignment + indent with semicolon", () => {
    const css = paraStyleToCss(
      parsePPr('<w:pPr><w:jc w:val="center"/><w:ind w:left="480"/></w:pPr>'),
    );
    expect(css).toBe("text-align:center;margin-left:24.0pt");
  });
});
