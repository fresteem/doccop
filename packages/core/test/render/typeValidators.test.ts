/**
 * Coverage targets:
 * - every DataType has an accept and a reject case
 * - normalisation (IBAN spaces, uppercase) preserved
 * - thrown errors carry the original (un-normalised) value
 */

import { describe, expect, it } from "vitest";
import { TypeValidationFailedError } from "../../src/errors.js";
import { validateValue } from "../../src/render/typeValidators.js";

describe("validateValue", () => {
  it("text accepts anything", () => {
    expect(validateValue("text", "t", "")).toBe("");
    expect(validateValue("text", "t", "Hello world! 你好")).toBe("Hello world! 你好");
  });

  it("number accepts integers and decimals", () => {
    expect(validateValue("number", "t", "0")).toBe("0");
    expect(validateValue("number", "t", "-42")).toBe("-42");
    expect(validateValue("number", "t", "3.14")).toBe("3.14");
  });

  it("number rejects garbage", () => {
    expect(() => validateValue("number", "t", "abc")).toThrow(TypeValidationFailedError);
    expect(() => validateValue("number", "t", "1.2.3")).toThrow();
    expect(() => validateValue("number", "t", "")).toThrow();
  });

  it("integer rejects decimals", () => {
    expect(validateValue("integer", "t", "42")).toBe("42");
    expect(validateValue("integer", "t", "-1")).toBe("-1");
    expect(() => validateValue("integer", "t", "3.14")).toThrow(TypeValidationFailedError);
  });

  it("date accepts ISO YYYY-MM-DD", () => {
    expect(validateValue("date", "t", "2026-05-20")).toBe("2026-05-20");
  });

  it("date rejects non-ISO and non-calendar dates", () => {
    expect(() => validateValue("date", "t", "20.05.2026")).toThrow(TypeValidationFailedError);
    expect(() => validateValue("date", "t", "2026-13-01")).toThrow(TypeValidationFailedError);
    expect(() => validateValue("date", "t", "2026-02-30")).toThrow(TypeValidationFailedError);
  });

  it("boolean accepts true/false/1/0 (any case)", () => {
    expect(validateValue("boolean", "t", "true")).toBe("true");
    expect(validateValue("boolean", "t", "False")).toBe("False");
    expect(validateValue("boolean", "t", "1")).toBe("1");
    expect(validateValue("boolean", "t", "0")).toBe("0");
  });

  it("boolean rejects other strings", () => {
    expect(() => validateValue("boolean", "t", "yes")).toThrow();
    expect(() => validateValue("boolean", "t", "2")).toThrow();
  });

  it("edrpou accepts exactly 8 digits", () => {
    expect(validateValue("edrpou", "t", "12345678")).toBe("12345678");
  });

  it("edrpou rejects wrong length or letters", () => {
    expect(() => validateValue("edrpou", "t", "1234567")).toThrow();
    expect(() => validateValue("edrpou", "t", "123456789")).toThrow();
    expect(() => validateValue("edrpou", "t", "abcdefgh")).toThrow();
  });

  it("rnokpp accepts exactly 10 digits", () => {
    expect(validateValue("rnokpp", "t", "1234567890")).toBe("1234567890");
  });

  it("rnokpp rejects 8 digits (EDRPOU shape, wrong type)", () => {
    expect(() => validateValue("rnokpp", "t", "12345678")).toThrow();
  });

  it("iban accepts spaced input and normalises to compact uppercase", () => {
    expect(validateValue("iban", "t", "UA21 3223 1300 0000 26007233566001")).toBe(
      "UA2132231300000026007233566001",
    );
    expect(validateValue("iban", "t", "de89370400440532013000")).toBe("DE89370400440532013000");
  });

  it("iban rejects too short / wrong start", () => {
    expect(() => validateValue("iban", "t", "UA21")).toThrow();
    expect(() => validateValue("iban", "t", "1234567890")).toThrow();
  });

  it("email accepts common shapes", () => {
    expect(validateValue("email", "t", "kostya@fest.foundation")).toBe("kostya@fest.foundation");
    expect(validateValue("email", "t", "a.b+c@sub.example.co")).toBe("a.b+c@sub.example.co");
  });

  it("email rejects missing @ or domain", () => {
    expect(() => validateValue("email", "t", "no-at-sign")).toThrow();
    expect(() => validateValue("email", "t", "user@nodot")).toThrow();
  });

  it("phone accepts 9-15 digits with punctuation", () => {
    expect(validateValue("phone", "t", "+380 67 123 4567")).toBe("+380 67 123 4567");
    expect(validateValue("phone", "t", "0671234567")).toBe("0671234567");
  });

  it("phone rejects too few digits", () => {
    expect(() => validateValue("phone", "t", "12345")).toThrow();
  });

  it("falls back to text for unknown DataType (forward compat)", () => {
    // @ts-expect-error — testing the forward-compat branch
    expect(validateValue("not-a-type", "t", "anything")).toBe("anything");
  });

  it("thrown error includes the original input value", () => {
    try {
      validateValue("edrpou", "party_a.edrpou", "abc");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TypeValidationFailedError);
      if (e instanceof TypeValidationFailedError) {
        expect(e.details["actual"]).toBe("abc");
        expect(e.details["expected"]).toBe("edrpou");
      }
    }
  });
});
