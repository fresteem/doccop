/**
 * Coverage targets:
 * - bare keys are rewritten to scoped form
 * - already-qualified tags are left alone
 * - requisites tags are rejected (no recursion)
 * - non-matching tag strings are ignored
 */

import { describe, expect, it } from "vitest";
import { ensureParaIds } from "../../src/docx/AnchorMapper.js";
import { parse } from "../../src/docx/DocxParser.js";
import { SnippetCannotContainRequisitesError } from "../../src/errors.js";
import { list } from "../../src/placeholders/PlaceholderEngine.js";
import { rewriteSnippetTags } from "../../src/requisites/TagRewriter.js";
import { buildDocxFixture } from "../fixtures/fixtureBuilder.js";

function setup(opts: Parameters<typeof buildDocxFixture>[0]) {
  const bytes = buildDocxFixture(opts);
  const archive = parse(bytes);
  ensureParaIds(archive);
  return archive;
}

describe("rewriteSnippetTags", () => {
  it("rewrites bare keys to <party>.<key>", () => {
    const snippet = setup({
      paragraphs: [
        { text: "Name: ", inlineSdt: { tag: "full_name", alias: "Name" } },
        { text: "ID: ", inlineSdt: { tag: "edrpou", alias: "ID" } },
      ],
    });
    const count = rewriteSnippetTags(snippet, "party_a");
    expect(count).toBe(2);
    const tags = list(snippet)
      .map((p) => p.tag)
      .sort();
    expect(tags).toEqual(["party_a.edrpou", "party_a.full_name"]);
  });

  it("leaves already-qualified tags alone", () => {
    const snippet = setup({
      paragraphs: [
        { text: "x", inlineSdt: { tag: "system.today", alias: "Date" } },
        { text: "y", inlineSdt: { tag: "party_b.full_name", alias: "B" } },
      ],
    });
    const count = rewriteSnippetTags(snippet, "party_a");
    expect(count).toBe(0);
    const tags = list(snippet)
      .map((p) => p.tag)
      .sort();
    expect(tags).toEqual(["party_b.full_name", "system.today"]);
  });

  it("rejects requisites tags (no nesting)", () => {
    const snippet = setup({
      paragraphs: [{ text: "x", inlineSdt: { tag: "requisites:party_a", alias: "R" } }],
    });
    expect(() => rewriteSnippetTags(snippet, "party_a")).toThrow(
      SnippetCannotContainRequisitesError,
    );
  });

  it("skips tags that don't match the bare-key pattern", () => {
    const snippet = setup({
      paragraphs: [{ text: "x", inlineSdt: { tag: "Bad Tag!", alias: "X" } }],
    });
    const count = rewriteSnippetTags(snippet, "party_a");
    expect(count).toBe(0);
  });
});
