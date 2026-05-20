/**
 * Validation + decomposition of placeholder tag strings.
 *
 * The engine recognises two tag shapes:
 *
 *   1. Value placeholders — `<scope>.<key>` where scope is `party_<id>`,
 *      `system`, or `custom`. The id and key are lowercase alphanumeric
 *      plus underscores. Example: `party_a.full_name`, `system.today`,
 *      `custom.contract_amount`.
 *
 *   2. Requisites placeholders — `requisites:<scope>` where scope is a
 *      party slot. These mark block-level injection points; the engine
 *      replaces them with a per-subtype snippet at render time.
 *      Example: `requisites:party_a`.
 *
 * Aliases are checked separately: non-empty, no control characters,
 * length 1..200.
 */

import { InvalidPlaceholderTagError } from "../errors.js";
import type { VariableScope } from "../types.js";

/** Maximum accepted tag length. */
const MAX_TAG_LENGTH = 100;
/** Maximum accepted alias length. */
const MAX_ALIAS_LENGTH = 200;

/** Matches `<scope>.<key>` value placeholder tags. */
const VALUE_TAG_PATTERN = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

/** Matches `requisites:<party_slot>` block tags. */
const REQUISITES_TAG_PATTERN = /^requisites:(party_[a-z0-9_]+)$/;

/** Structured decomposition of a validated tag. */
export type DecomposedTag =
  | { kind: "value"; tag: string; scope: VariableScope; key: string }
  | { kind: "requisites"; tag: string; partyRole: string };

/**
 * Validate a tag string and split it into its parts.
 *
 * @throws {InvalidPlaceholderTagError} when the tag does not match either
 *   accepted shape, is empty, or exceeds the length limit.
 */
export function decomposeTag(tag: string): DecomposedTag {
  if (!tag) {
    throw new InvalidPlaceholderTagError(tag, "tag must not be empty");
  }
  if (tag.length > MAX_TAG_LENGTH) {
    throw new InvalidPlaceholderTagError(
      tag,
      `tag length ${tag.length} exceeds limit ${MAX_TAG_LENGTH}`,
    );
  }

  const reqMatch = tag.match(REQUISITES_TAG_PATTERN);
  if (reqMatch) {
    const partyRole = reqMatch[1];
    if (!partyRole) {
      throw new InvalidPlaceholderTagError(tag, "requisites tag missing party role");
    }
    return { kind: "requisites", tag, partyRole };
  }

  const valMatch = tag.match(VALUE_TAG_PATTERN);
  if (valMatch) {
    const scope = valMatch[1] as VariableScope | undefined;
    const key = valMatch[2];
    if (!scope || !key) {
      // The regex group cardinality guarantees presence, but TS narrowing
      // requires the check — fall through to the generic error path.
      throw new InvalidPlaceholderTagError(tag, "scope or key missing after split");
    }
    return { kind: "value", tag, scope, key };
  }

  throw new InvalidPlaceholderTagError(
    tag,
    "tag must be `<scope>.<key>` (scope = party_<id> | system | custom) or `requisites:party_<id>`",
  );
}

/**
 * Validate an alias string.
 *
 * @throws {InvalidPlaceholderTagError} when empty, too long, or contains
 *   ASCII control characters.
 */
export function validateAlias(tag: string, alias: string): void {
  if (!alias) {
    throw new InvalidPlaceholderTagError(tag, "alias must not be empty");
  }
  if (alias.length > MAX_ALIAS_LENGTH) {
    throw new InvalidPlaceholderTagError(
      tag,
      `alias length ${alias.length} exceeds limit ${MAX_ALIAS_LENGTH}`,
    );
  }
  // Reject ASCII control characters (0x00-0x1F, 0x7F). Newlines and tabs
  // inside an alias would break Word's UI rendering. We loop rather than
  // using a regex so the source contains no literal control characters
  // (which lint and reviewers would flag).
  for (let i = 0; i < alias.length; i++) {
    const code = alias.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      throw new InvalidPlaceholderTagError(tag, "alias must not contain control characters");
    }
  }
}
