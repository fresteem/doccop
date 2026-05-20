/**
 * Public surface of the render subsystem.
 */

export { render, findResolver, listResolverScopes } from "./DocxRenderer.js";
export { buildResolveContext } from "./VariableContext.js";
export { validateValue } from "./typeValidators.js";
export type { RenderRequest, RenderConfig } from "./types.js";
