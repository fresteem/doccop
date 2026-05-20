/**
 * Tests for w14:paraId anchor mapping.
 *
 * Coverage:
 * - ensureParaIds generates an id for every paragraph that lacks one
 * - existing well-formed ids are preserved verbatim
 * - duplicates within the same document are regenerated
 * - malformed ids (lowercase, wrong length) are regenerated
 * - findByParaId locates the right paragraph
 * - findByParaId returns null for unknown / malformed ids
 * - listParagraphs enumerates in document order
 * - w14 namespace declaration is added to the root when missing
 * - generated ids match the canonical 8-hex-uppercase format
 * - serialise → reparse preserves all paraIds
 */

import { describe, expect, it } from "vitest";
import { ensureParaIds, findByParaId, listParagraphs } from "../../src/docx/AnchorMapper.js";
import { parse, serialize } from "../../src/docx/DocxParser.js";
import { W14_NS, W_NS, findElements } from "../../src/docx/xml-utils.js";
import { buildDocxFixture } from "../fixtures/fixtureBuilder.js";

const PARA_ID_FORMAT = /^[0-9A-F]{8}$/;

describe("AnchorMapper.ensureParaIds", () => {
  it("generates ids for paragraphs that have none", () => {
    const bytes = buildDocxFixture({
      paragraphs: [{ text: "one" }, { text: "two" }, { text: "three" }],
    });
    const archive = parse(bytes);
    const result = ensureParaIds(archive);
    expect(result.generated).toBe(3);
    expect(result.preserved).toBe(0);

    const paras = findElements(archive.document, W_NS, "p");
    for (const p of paras) {
      const id = p.getAttributeNS(W14_NS, "paraId");
      expect(id).toMatch(PARA_ID_FORMAT);
    }
  });

  it("preserves existing well-formed ids verbatim", () => {
    const bytes = buildDocxFixture({
      paragraphs: [
        { text: "fixed", paraId: "0123ABCD" },
        { text: "also fixed", paraId: "DEADBEEF" },
      ],
    });
    const archive = parse(bytes);
    const result = ensureParaIds(archive);
    expect(result.preserved).toBe(2);
    expect(result.generated).toBe(0);

    const paras = findElements(archive.document, W_NS, "p");
    expect(paras[0]?.getAttributeNS(W14_NS, "paraId")).toBe("0123ABCD");
    expect(paras[1]?.getAttributeNS(W14_NS, "paraId")).toBe("DEADBEEF");
  });

  it("regenerates malformed ids (lowercase, wrong length)", () => {
    const bytes = buildDocxFixture({
      paragraphs: [
        { text: "bad lower", paraId: "abcdef12" },
        { text: "too short", paraId: "ABCD" },
      ],
    });
    const archive = parse(bytes);
    const result = ensureParaIds(archive);
    expect(result.generated).toBe(2);
    expect(result.preserved).toBe(0);

    const paras = findElements(archive.document, W_NS, "p");
    for (const p of paras) {
      const id = p.getAttributeNS(W14_NS, "paraId");
      expect(id).toMatch(PARA_ID_FORMAT);
      expect(id).not.toBe("abcdef12");
      expect(id).not.toBe("ABCD");
    }
  });

  it("deduplicates collisions within the same document", () => {
    const bytes = buildDocxFixture({
      paragraphs: [
        { text: "first", paraId: "AAAAAAAA" },
        { text: "duplicate", paraId: "AAAAAAAA" },
      ],
    });
    const archive = parse(bytes);
    const result = ensureParaIds(archive);
    expect(result.preserved).toBe(1);
    expect(result.generated).toBe(1);

    const ids = listParagraphs(archive).map((p) => p.paraId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("adds the w14 namespace declaration to the root when missing", () => {
    // The fixture builder always declares w14, so simulate the missing
    // case by stripping the attribute after parsing.
    const bytes = buildDocxFixture({ paragraphs: [{ text: "x" }] });
    const archive = parse(bytes);
    archive.document.documentElement?.removeAttribute("xmlns:w14");
    expect(archive.document.documentElement?.getAttribute("xmlns:w14")).toBeFalsy();

    ensureParaIds(archive);
    expect(archive.document.documentElement?.getAttribute("xmlns:w14")).toBe(W14_NS);
  });
});

describe("AnchorMapper.findByParaId", () => {
  it("returns the paragraph with the matching id", () => {
    const bytes = buildDocxFixture({
      paragraphs: [
        { text: "alpha", paraId: "11111111" },
        { text: "beta", paraId: "22222222" },
      ],
    });
    const archive = parse(bytes);
    ensureParaIds(archive);

    const target = findByParaId(archive, "22222222");
    expect(target).not.toBeNull();
    expect(target?.textContent?.trim()).toBe("beta");
  });

  it("returns null for unknown ids", () => {
    const bytes = buildDocxFixture({ paragraphs: [{ text: "x", paraId: "AAAAAAAA" }] });
    const archive = parse(bytes);
    expect(findByParaId(archive, "FFFFFFFF")).toBeNull();
  });

  it("returns null for malformed ids", () => {
    const bytes = buildDocxFixture({ paragraphs: [{ text: "x", paraId: "AAAAAAAA" }] });
    const archive = parse(bytes);
    expect(findByParaId(archive, "not-an-id")).toBeNull();
    expect(findByParaId(archive, "aaaa")).toBeNull();
  });
});

describe("AnchorMapper round-trip", () => {
  it("paraIds survive serialise → reparse", () => {
    const bytes = buildDocxFixture({
      paragraphs: [{ text: "one" }, { text: "two" }, { text: "three" }],
    });
    const archive = parse(bytes);
    ensureParaIds(archive);
    const idsBefore = listParagraphs(archive).map((p) => p.paraId);

    const re = serialize(archive);
    const archive2 = parse(re);
    const idsAfter = listParagraphs(archive2).map((p) => p.paraId);

    expect(idsAfter).toEqual(idsBefore);
  });

  it("ensureParaIds is idempotent", () => {
    const bytes = buildDocxFixture({
      paragraphs: [{ text: "a" }, { text: "b" }],
    });
    const archive = parse(bytes);
    ensureParaIds(archive);
    const idsFirst = listParagraphs(archive).map((p) => p.paraId);
    const result = ensureParaIds(archive);
    expect(result.generated).toBe(0);
    expect(result.preserved).toBe(2);
    const idsSecond = listParagraphs(archive).map((p) => p.paraId);
    expect(idsSecond).toEqual(idsFirst);
  });
});
