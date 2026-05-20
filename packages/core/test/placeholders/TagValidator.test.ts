/**
 * Coverage targets for TagValidator:
 * - decomposeTag accepts well-formed value tags
 * - decomposeTag accepts requisites tags
 * - decomposeTag rejects empty / oversized / malformed
 * - validateAlias accepts valid aliases
 * - validateAlias rejects empty / oversized / control-char aliases
 */

import { describe, expect, it } from "vitest";
import { InvalidPlaceholderTagError } from "../../src/errors.js";
import { decomposeTag, validateAlias } from "../../src/placeholders/TagValidator.js";

describe("decomposeTag — value tags", () => {
  it("decomposes party_a.full_name", () => {
    const d = decomposeTag("party_a.full_name");
    expect(d.kind).toBe("value");
    if (d.kind === "value") {
      expect(d.scope).toBe("party_a");
      expect(d.key).toBe("full_name");
      expect(d.tag).toBe("party_a.full_name");
    }
  });

  it("decomposes system.today", () => {
    const d = decomposeTag("system.today");
    expect(d.kind).toBe("value");
    if (d.kind === "value") {
      expect(d.scope).toBe("system");
      expect(d.key).toBe("today");
    }
  });

  it("decomposes custom.contract_amount", () => {
    const d = decomposeTag("custom.contract_amount");
    expect(d.kind).toBe("value");
    if (d.kind === "value") {
      expect(d.scope).toBe("custom");
      expect(d.key).toBe("contract_amount");
    }
  });

  it("accepts party_z_42 style scope", () => {
    const d = decomposeTag("party_z_42.foo");
    expect(d.kind).toBe("value");
    if (d.kind === "value") expect(d.scope).toBe("party_z_42");
  });
});

describe("decomposeTag — requisites tags", () => {
  it("decomposes requisites:party_a", () => {
    const d = decomposeTag("requisites:party_a");
    expect(d.kind).toBe("requisites");
    if (d.kind === "requisites") {
      expect(d.partyRole).toBe("party_a");
      expect(d.tag).toBe("requisites:party_a");
    }
  });

  it("decomposes requisites:party_b", () => {
    const d = decomposeTag("requisites:party_b");
    expect(d.kind).toBe("requisites");
  });
});

describe("decomposeTag — rejections", () => {
  it("rejects empty tag", () => {
    expect(() => decomposeTag("")).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects tag longer than 100 chars", () => {
    const long = `party_a.${"x".repeat(100)}`;
    expect(() => decomposeTag(long)).toThrow(/length/);
  });

  it("rejects bare scope without key", () => {
    expect(() => decomposeTag("party_a")).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects bare key without scope", () => {
    expect(() => decomposeTag(".key")).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects multiple dots", () => {
    expect(() => decomposeTag("a.b.c")).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects uppercase characters", () => {
    expect(() => decomposeTag("Party_A.Full_Name")).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects whitespace", () => {
    expect(() => decomposeTag("party_a .full_name")).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects scope starting with digit", () => {
    expect(() => decomposeTag("1party.key")).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects requisites:non_party", () => {
    expect(() => decomposeTag("requisites:foo")).toThrow(InvalidPlaceholderTagError);
  });
});

describe("validateAlias", () => {
  it("accepts ordinary aliases", () => {
    expect(() => validateAlias("t", "Сторона А — повна назва")).not.toThrow();
    expect(() => validateAlias("t", "Customer name")).not.toThrow();
  });

  it("rejects empty alias", () => {
    expect(() => validateAlias("t", "")).toThrow(InvalidPlaceholderTagError);
  });

  it("rejects alias longer than 200 chars", () => {
    expect(() => validateAlias("t", "x".repeat(201))).toThrow(/length/);
  });

  it("rejects ASCII control characters", () => {
    // 0x09 = tab, 0x0A = LF, 0x0D = CR
    expect(() => validateAlias("t", "ab\tcd")).toThrow(InvalidPlaceholderTagError);
    expect(() => validateAlias("t", "ab\ncd")).toThrow(InvalidPlaceholderTagError);
    expect(() => validateAlias("t", "ab\rcd")).toThrow(InvalidPlaceholderTagError);
  });

  it("accepts non-ASCII characters (Cyrillic, em-dash, etc.)", () => {
    expect(() => validateAlias("t", "Сторона")).not.toThrow();
    expect(() => validateAlias("t", "A — B")).not.toThrow();
  });
});
