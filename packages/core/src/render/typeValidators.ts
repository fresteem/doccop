/**
 * Runtime validators for placeholder data types.
 *
 * The engine ships ten data types (see `DataType` in `../types.ts`).
 * Resolvers return `ResolvedValue.kind = "text"` with a string payload;
 * the renderer asks the matching validator whether that payload is
 * acceptable for the placeholder's declared type.
 *
 * Validators return either the (potentially normalised) value or throw
 * `TypeValidationFailedError`. Normalisation is conservative — we don't
 * reformat numbers or dates (that's a host-application concern), only
 * verify the string is well-formed and reject obvious garbage like
 * letters in an EDRPOU field.
 */

import { TypeValidationFailedError } from "../errors.js";
import type { DataType } from "../types.js";

type Validator = (tag: string, value: string) => string;

const VALIDATORS: Record<DataType, Validator> = {
  text: (_tag, value) => value,

  number: (tag, value) => {
    if (!/^-?\d+(\.\d+)?$/.test(value)) {
      throw new TypeValidationFailedError(tag, "number", value);
    }
    return value;
  },

  integer: (tag, value) => {
    if (!/^-?\d+$/.test(value)) {
      throw new TypeValidationFailedError(tag, "integer", value);
    }
    return value;
  },

  date: (tag, value) => {
    // Accept ISO `YYYY-MM-DD`. We don't try to parse arbitrary formats —
    // resolvers should normalise upstream.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new TypeValidationFailedError(tag, "date", value);
    }
    // Check it's actually a real calendar day.
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
      throw new TypeValidationFailedError(tag, "date", value);
    }
    return value;
  },

  boolean: (tag, value) => {
    const lower = value.toLowerCase();
    if (lower !== "true" && lower !== "false" && lower !== "1" && lower !== "0") {
      throw new TypeValidationFailedError(tag, "boolean", value);
    }
    return value;
  },

  edrpou: (tag, value) => {
    // Ukrainian state registry code for legal entities: exactly 8 digits.
    if (!/^\d{8}$/.test(value)) {
      throw new TypeValidationFailedError(tag, "edrpou", value);
    }
    return value;
  },

  rnokpp: (tag, value) => {
    // Ukrainian individual taxpayer code: exactly 10 digits.
    if (!/^\d{10}$/.test(value)) {
      throw new TypeValidationFailedError(tag, "rnokpp", value);
    }
    return value;
  },

  iban: (tag, value) => {
    // ISO 13616: two-letter country code + 2 check digits + up to 30
    // alphanumeric. We normalise to uppercase and strip spaces because
    // Ukrainian bank statements often include both.
    const compact = value.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
      throw new TypeValidationFailedError(tag, "iban", value);
    }
    return compact;
  },

  email: (tag, value) => {
    // RFC 5322 in full is overkill — we use a sensible "looks like an
    // email" pattern matching what Word users actually type. Hosts that
    // need stricter validation should normalise in their resolver.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new TypeValidationFailedError(tag, "email", value);
    }
    return value;
  },

  phone: (tag, value) => {
    // Allow common punctuation but require at least 9 digits total
    // (national plans vary; this is a generous floor).
    const digits = value.replace(/\D+/g, "");
    if (digits.length < 9 || digits.length > 15) {
      throw new TypeValidationFailedError(tag, "phone", value);
    }
    return value;
  },
};

/**
 * Validate a resolved string against its placeholder's declared type.
 *
 * @returns the (possibly normalised) value.
 * @throws {TypeValidationFailedError} when validation fails.
 */
export function validateValue(dataType: DataType, tag: string, value: string): string {
  const validator = VALIDATORS[dataType];
  if (!validator) {
    // Unknown DataType — treat as text (forward compat with future enum
    // additions handed to an older engine).
    return value;
  }
  return validator(tag, value);
}
