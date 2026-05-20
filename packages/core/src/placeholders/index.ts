/**
 * Public surface of the placeholders subsystem.
 */

export { list, wrap, unwrap, replace } from "./PlaceholderEngine.js";
export { decomposeTag, validateAlias } from "./TagValidator.js";
export type { DecomposedTag } from "./TagValidator.js";
export type { WrapLocation, PlaceholderSpec } from "./types.js";
