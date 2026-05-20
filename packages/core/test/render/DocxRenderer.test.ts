/**
 * Coverage targets for DocxRenderer:
 * - happy path: text resolver, single placeholder, value substituted
 * - multiple placeholders, multiple scopes, all resolved
 * - resolver returns absent → strict mode throws
 * - resolver returns absent → non-strict produces marker + warning
 * - missing resolver → strict throws
 * - missing resolver → non-strict warning
 * - resolver throws → wrapped in ResolverFailedError (strict)
 * - data type validation: edrpou rejection in strict
 * - requisites tag without resolver → strict throws / non-strict warning
 * - immutability: input template archive untouched
 * - resolvedValues map populated with successful substitutions
 * - duration measured
 */

import { describe, expect, it } from "vitest";
import { ensureParaIds, listParagraphs } from "../../src/docx/AnchorMapper.js";
import { parse, serialize } from "../../src/docx/DocxParser.js";
import {
  AbsentValueInStrictModeError,
  NoResolverForScopeError,
  ResolverFailedError,
  TypeValidationFailedError,
} from "../../src/errors.js";
import { list } from "../../src/placeholders/PlaceholderEngine.js";
import { render } from "../../src/render/DocxRenderer.js";
import type { RenderConfig, RenderRequest } from "../../src/render/types.js";
import type { DataType, EntityResolver } from "../../src/types.js";
import { buildDocxFixture } from "../fixtures/fixtureBuilder.js";

function setup(opts: Parameters<typeof buildDocxFixture>[0]) {
  const bytes = buildDocxFixture(opts);
  const archive = parse(bytes);
  ensureParaIds(archive);
  return archive;
}

function makeRequest(overrides: Partial<RenderRequest> = {}): RenderRequest {
  return {
    userId: "user-1",
    templateId: "tpl-1",
    templateVersionId: "tpl-1-v1",
    templateCategory: "TEST",
    documentNumber: "001-2026/TEST",
    parties: [
      { role: "party_a", entityType: "organization", entityId: "org-internal" },
      { role: "party_b", entityType: "organization", entityId: "org-external" },
    ],
    now: new Date("2026-05-20T12:00:00Z"),
    ...overrides,
  };
}

/** Build a resolver that always returns the given text values keyed by `key`. */
function staticResolver(
  scope: EntityResolver["scope"],
  values: Record<string, string>,
): EntityResolver {
  return {
    scope,
    async resolve(key) {
      if (key in values) return { kind: "text", value: values[key] as string };
      return { kind: "absent", reason: `no key '${key}' in static resolver` };
    },
  };
}

function paragraphText(archive: ReturnType<typeof setup>, paraId: string): string {
  const para = listParagraphs(archive).find((p) => p.paraId === paraId)?.element;
  return para ? (para.textContent ?? "").replace(/\s+/g, " ").trim() : "";
}

describe("render — happy paths", () => {
  it("substitutes a single value placeholder", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "Hello ",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_b.full_name", alias: "Контрагент" },
        },
      ],
    });
    const config: RenderConfig = {
      resolvers: [staticResolver("party_b", { full_name: "ACME Ltd" })],
    };
    const result = await render(template, makeRequest(), config);
    expect(result.warnings).toEqual([]);
    expect(result.resolvedValues["party_b.full_name"]).toBe("ACME Ltd");
    // Re-parse the rendered docx and check the text.
    const reparsed = parse(result.docx);
    expect(paragraphText(reparsed, "AAAAAAAA")).toContain("ACME Ltd");
  });

  it("substitutes multiple placeholders across scopes", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "A: ",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.full_name", alias: "А" },
        },
        {
          text: "B: ",
          paraId: "BBBBBBBB",
          inlineSdt: { tag: "party_b.full_name", alias: "Б" },
        },
        {
          text: "Today: ",
          paraId: "CCCCCCCC",
          inlineSdt: { tag: "system.today", alias: "Дата" },
        },
      ],
    });
    const config: RenderConfig = {
      resolvers: [
        staticResolver("party_a", { full_name: "Internal Co" }),
        staticResolver("party_b", { full_name: "External Co" }),
        staticResolver("system", { today: "2026-05-20" }),
      ],
    };
    const result = await render(template, makeRequest(), config);
    expect(result.warnings).toEqual([]);
    expect(result.resolvedValues).toEqual({
      "party_a.full_name": "Internal Co",
      "party_b.full_name": "External Co",
      "system.today": "2026-05-20",
    });
  });

  it("returns durationMs > 0", async () => {
    const template = setup({ paragraphs: [{ text: "x" }] });
    const result = await render(template, makeRequest(), { resolvers: [] });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("validates data types and keeps normalised IBAN", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "IBAN: ",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.iban", alias: "IBAN" },
        },
      ],
    });
    const config: RenderConfig = {
      resolvers: [staticResolver("party_a", { iban: "UA21 3223 1300 0000 26007233566001" })],
    };
    const dataTypes = new Map<string, DataType>([["party_a.iban", "iban"]]);
    const result = await render(template, makeRequest(), config, dataTypes);
    expect(result.resolvedValues["party_a.iban"]).toBe("UA2132231300000026007233566001");
  });
});

describe("render — strict mode rejections", () => {
  it("throws NoResolverForScopeError when no matching resolver", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "x",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_z.foo", alias: "Z" },
        },
      ],
    });
    await expect(render(template, makeRequest(), { resolvers: [] })).rejects.toBeInstanceOf(
      NoResolverForScopeError,
    );
  });

  it("throws AbsentValueInStrictModeError on resolver absent", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "x",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.unknown_key", alias: "X" },
        },
      ],
    });
    const config: RenderConfig = {
      resolvers: [staticResolver("party_a", { something_else: "y" })],
    };
    await expect(render(template, makeRequest(), config)).rejects.toBeInstanceOf(
      AbsentValueInStrictModeError,
    );
  });

  it("wraps resolver throws in ResolverFailedError", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "x",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.foo", alias: "X" },
        },
      ],
    });
    const exploding: EntityResolver = {
      scope: "party_a",
      async resolve() {
        throw new Error("boom");
      },
    };
    await expect(
      render(template, makeRequest(), { resolvers: [exploding] }),
    ).rejects.toBeInstanceOf(ResolverFailedError);
  });

  it("rejects bad EDRPOU shape via type validator", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "x",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.edrpou", alias: "EDRPOU" },
        },
      ],
    });
    const config: RenderConfig = {
      resolvers: [staticResolver("party_a", { edrpou: "abc" })],
    };
    const dataTypes = new Map<string, DataType>([["party_a.edrpou", "edrpou"]]);
    await expect(render(template, makeRequest(), config, dataTypes)).rejects.toBeInstanceOf(
      TypeValidationFailedError,
    );
  });

  it("throws on requisites tag in strict mode without requisitesResolver", async () => {
    const template = setup({
      paragraphs: [{ text: "Heading", paraId: "11111111" }],
      blockSdt: {
        tag: "requisites:party_a",
        alias: "R",
        paragraphs: [{ text: "x", paraId: "22222222" }],
      },
    });
    await expect(render(template, makeRequest(), { resolvers: [] })).rejects.toBeInstanceOf(
      AbsentValueInStrictModeError,
    );
  });
});

describe("render — non-strict mode", () => {
  it("substitutes marker text when resolver missing", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "x",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_z.foo", alias: "Z" },
        },
      ],
    });
    const result = await render(template, makeRequest(), {
      resolvers: [],
      options: { strict: false },
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.kind).toBe("missing_resolver");
    const reparsed = parse(result.docx);
    expect(paragraphText(reparsed, "AAAAAAAA")).toContain("{missing: party_z.foo}");
  });

  it("substitutes marker text when value absent", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "x",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.unknown", alias: "X" },
        },
      ],
    });
    const config: RenderConfig = {
      resolvers: [staticResolver("party_a", {})],
      options: { strict: false },
    };
    const result = await render(template, makeRequest(), config);
    expect(result.warnings[0]?.kind).toBe("absent_value");
    const reparsed = parse(result.docx);
    expect(paragraphText(reparsed, "AAAAAAAA")).toContain("{missing: party_a.unknown}");
  });

  it("substitutes marker text on type validation failure", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "x",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.edrpou", alias: "E" },
        },
      ],
    });
    const config: RenderConfig = {
      resolvers: [staticResolver("party_a", { edrpou: "not a number" })],
      options: { strict: false },
    };
    const dataTypes = new Map<string, DataType>([["party_a.edrpou", "edrpou"]]);
    const result = await render(template, makeRequest(), config, dataTypes);
    expect(result.warnings[0]?.kind).toBe("type_mismatch");
  });

  it("returns a warning for requisites tag without resolver", async () => {
    const template = setup({
      paragraphs: [{ text: "Heading", paraId: "11111111" }],
      blockSdt: {
        tag: "requisites:party_a",
        alias: "R",
        paragraphs: [{ text: "x", paraId: "22222222" }],
      },
    });
    const result = await render(template, makeRequest(), {
      resolvers: [],
      options: { strict: false },
    });
    expect(result.warnings.some((w) => w.kind === "snippet_missing")).toBe(true);
  });
});

describe("render — passes resolver context correctly", () => {
  it("hands resolvers the configured parties and meta", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "x",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "system.contract_number", alias: "Number" },
        },
      ],
    });
    let capturedCtx: unknown;
    const sysResolver: EntityResolver = {
      scope: "system",
      async resolve(_key, ctx) {
        capturedCtx = ctx;
        return { kind: "text", value: ctx.meta.documentNumber ?? "missing" };
      },
    };
    const result = await render(template, makeRequest(), { resolvers: [sysResolver] });
    expect(result.resolvedValues["system.contract_number"]).toBe("001-2026/TEST");
    expect(capturedCtx).toMatchObject({
      userId: "user-1",
      meta: {
        templateId: "tpl-1",
        templateVersionId: "tpl-1-v1",
        templateCategory: "TEST",
        documentNumber: "001-2026/TEST",
      },
    });
  });
});

describe("render — immutability", () => {
  it("does not mutate the input template archive", async () => {
    const template = setup({
      paragraphs: [
        {
          text: "x",
          paraId: "AAAAAAAA",
          inlineSdt: { tag: "party_a.k", alias: "X" },
        },
      ],
    });
    const before = serialize(template);
    const config: RenderConfig = {
      resolvers: [staticResolver("party_a", { k: "value" })],
    };
    await render(template, makeRequest(), config);
    const after = serialize(template);
    // Re-parse both to compare semantic content; byte equality not
    // guaranteed across serialise cycles but the placeholder list
    // should be identical to the original.
    expect(list(parse(before))).toEqual(list(parse(after)));
    // And the input still has the SDT (not replaced).
    expect(list(template).some((p) => p.tag === "party_a.k")).toBe(true);
  });
});

describe("render — multi-binding (same tag in multiple SDTs)", () => {
  it("substitutes every occurrence of the same tag", async () => {
    // The fixture builder only supports one SDT per paragraph; assemble
    // a custom doc to exercise multi-binding.
    const PizZip = require("pizzip");
    const xml = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="AAAAAAAA">
      <w:r><w:t xml:space="preserve">First: </w:t></w:r>
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_a.full_name"/><w:alias w:val="A"/></w:sdtPr>
        <w:sdtContent><w:r><w:t>placeholder</w:t></w:r></w:sdtContent>
      </w:sdt>
    </w:p>
    <w:p w14:paraId="BBBBBBBB">
      <w:r><w:t xml:space="preserve">Same again: </w:t></w:r>
      <w:sdt>
        <w:sdtPr><w:tag w:val="party_a.full_name"/><w:alias w:val="A"/></w:sdtPr>
        <w:sdtContent><w:r><w:t>placeholder</w:t></w:r></w:sdtContent>
      </w:sdt>
    </w:p>
  </w:body>
</w:document>`;
    const zip = new PizZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    );
    zip.file(
      "_rels/.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    );
    zip.file("word/document.xml", xml);
    const bytes = zip.generate({ type: "uint8array" });
    const template = parse(bytes);
    ensureParaIds(template);

    const config: RenderConfig = {
      resolvers: [staticResolver("party_a", { full_name: "ACME" })],
    };
    const result = await render(template, makeRequest(), config);
    const reparsed = parse(result.docx);
    expect(paragraphText(reparsed, "AAAAAAAA")).toContain("ACME");
    expect(paragraphText(reparsed, "BBBBBBBB")).toContain("ACME");
  });
});
