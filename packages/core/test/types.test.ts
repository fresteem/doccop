/**
 * Compile-time contract tests for @doccop/core public types.
 *
 * These tests don't exercise runtime behaviour — they exist so that a
 * breaking change to an interface signature is caught by `vitest run`
 * (via `tsc`). If this file fails to compile, the public API has
 * regressed.
 *
 * As implementations land in later Waves, true behaviour tests will live
 * alongside their modules.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AuthForbiddenError,
  DocCopError,
  MalformedDocxError,
  NoResolverForScopeError,
  OverlappingPlaceholderError,
  TypeValidationFailedError,
} from "../src/errors.js";
import type {
  DataType,
  DocCopConfig,
  EntityResolver,
  NamingService,
  NumberingService,
  Placeholder,
  RequisitesResolver,
  ResolveContext,
  ResolvedValue,
  StorageAdapter,
  VariableScope,
} from "../src/types.js";

describe("type contracts", () => {
  it("VariableScope accepts party_x, system, custom", () => {
    expectTypeOf<"party_a">().toMatchTypeOf<VariableScope>();
    expectTypeOf<"party_b">().toMatchTypeOf<VariableScope>();
    expectTypeOf<"party_z_42">().toMatchTypeOf<VariableScope>();
    expectTypeOf<"system">().toMatchTypeOf<VariableScope>();
    expectTypeOf<"custom">().toMatchTypeOf<VariableScope>();
  });

  it("DataType enumerates the v1 supported types", () => {
    const validTypes: DataType[] = [
      "text",
      "number",
      "integer",
      "date",
      "boolean",
      "edrpou",
      "rnokpp",
      "iban",
      "email",
      "phone",
    ];
    expect(validTypes).toHaveLength(10);
  });

  it("ResolvedValue is a discriminated union by `kind`", () => {
    const text: ResolvedValue = { kind: "text", value: "abc" };
    const image: ResolvedValue = {
      kind: "image",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    };
    const absent: ResolvedValue = { kind: "absent" };
    expect([text.kind, image.kind, absent.kind]).toEqual(["text", "image", "absent"]);
  });

  it("EntityResolver matches the contract shape", () => {
    const r: EntityResolver = {
      scope: "party_a",
      async resolve(_key, _ctx) {
        return { kind: "absent" };
      },
    };
    expectTypeOf(r.resolve).parameters.toMatchTypeOf<[string, ResolveContext]>();
  });

  it("RequisitesResolver returns snippet or null", () => {
    const r: RequisitesResolver = {
      async resolveSnippet(_t, _s) {
        return null;
      },
    };
    expect(r).toBeDefined();
  });

  it("NumberingService.allocate is async string", () => {
    const n: NumberingService = {
      async allocate(_ctx) {
        return "001-2026/TEST";
      },
    };
    expectTypeOf(n.allocate).returns.toMatchTypeOf<Promise<string>>();
  });

  it("NamingService.format is synchronous", () => {
    const n: NamingService = {
      format: (ctx) => ctx.number.replace(/\//g, "_"),
    };
    expectTypeOf(n.format).returns.toMatchTypeOf<string>();
  });

  it("StorageAdapter exposes the six methods for v1", () => {
    const s: StorageAdapter = {
      async saveTemplate() {
        return "path";
      },
      async loadTemplate() {
        return new Uint8Array();
      },
      async saveDocument() {
        return "path";
      },
      async loadDocument() {
        return new Uint8Array();
      },
      async saveSnippet() {
        return "path";
      },
      async loadSnippet() {
        return new Uint8Array();
      },
      async signedUrl() {
        return "https://example.com";
      },
    };
    expect(Object.keys(s)).toHaveLength(7);
  });

  it("Placeholder carries the SDT tag, alias, scope, key, dataType, paraId", () => {
    const p: Placeholder = {
      tag: "party_a.full_name",
      alias: "Сторона А — повна назва",
      scope: "party_a",
      key: "full_name",
      dataType: "text",
      paraId: "0123ABCD",
    };
    expect(p.tag).toBe("party_a.full_name");
  });

  it("DocCopConfig requires storage, resolvers, requisites, numbering, naming", () => {
    expectTypeOf<DocCopConfig>().toHaveProperty("storage");
    expectTypeOf<DocCopConfig>().toHaveProperty("resolvers");
    expectTypeOf<DocCopConfig>().toHaveProperty("requisitesResolver");
    expectTypeOf<DocCopConfig>().toHaveProperty("numbering");
    expectTypeOf<DocCopConfig>().toHaveProperty("naming");
  });
});

describe("error hierarchy", () => {
  it("All concrete errors extend DocCopError", () => {
    const errors: DocCopError[] = [
      new MalformedDocxError("bad zip"),
      new NoResolverForScopeError("party_z", "party_z.foo"),
      new OverlappingPlaceholderError("party_a.full_name"),
      new AuthForbiddenError("edit template"),
      new TypeValidationFailedError("party_a.edrpou", "edrpou", "abc"),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(DocCopError);
      expect(e).toBeInstanceOf(Error);
      expect(typeof e.code).toBe("string");
      expect(typeof e.message).toBe("string");
      expect(e.details).toBeDefined();
    }
  });

  it("Error code is narrow-typed per subclass", () => {
    const e = new MalformedDocxError("oops");
    // Compile check: code is exactly the literal, not the wide union.
    expectTypeOf(e.code).toEqualTypeOf<"MALFORMED_DOCX">();
  });

  it("Errors carry frozen details", () => {
    const e = new TypeValidationFailedError("party_a.edrpou", "edrpou", "abc");
    expect(() => {
      // @ts-expect-error — details is readonly + frozen
      e.details.foo = "bar";
    }).toThrow();
  });

  it("Errors preserve instanceof across throw/catch boundaries", () => {
    try {
      throw new OverlappingPlaceholderError("party_a.full_name");
    } catch (err) {
      expect(err).toBeInstanceOf(OverlappingPlaceholderError);
      expect(err).toBeInstanceOf(DocCopError);
      if (err instanceof OverlappingPlaceholderError) {
        expect(err.details["existingTag"]).toBe("party_a.full_name");
      }
    }
  });
});
