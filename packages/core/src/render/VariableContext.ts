/**
 * Build the `ResolveContext` handed to resolvers + route placeholder
 * scopes to their resolvers.
 *
 * Routing rule: a resolver's `scope` matches a placeholder's `scope`
 * by string equality. If multiple resolvers claim the same scope, the
 * FIRST one wins — `DocCopConfig.resolvers` is order-sensitive so the
 * host can layer overrides above defaults.
 */

import type { EntityResolver, ResolveContext, VariableScope } from "../types.js";
import type { RenderRequest } from "./types.js";

/**
 * Assemble the `ResolveContext` for the current render. Each placeholder
 * resolution shares the same context object — resolvers may stash
 * caches on it across calls within a single render, but the engine
 * does not persist anything itself.
 */
export function buildResolveContext(
  req: RenderRequest,
  templateCategory: string | null,
): ResolveContext {
  const partiesMap: Record<string, ResolveContext["parties"][string]> = {};
  for (const party of req.parties) {
    partiesMap[party.role] = party;
  }
  return {
    userId: req.userId,
    parties: partiesMap,
    meta: {
      templateId: req.templateId,
      templateVersionId: req.templateVersionId,
      templateCategory,
      documentNumber: req.documentNumber,
      now: req.now ?? new Date(),
    },
  };
}

/**
 * Find the resolver for a given scope. Returns `null` when no resolver
 * is registered. Order-sensitive on the input array.
 */
export function findResolver(
  resolvers: readonly EntityResolver[],
  scope: VariableScope,
): EntityResolver | null {
  for (const r of resolvers) {
    if (r.scope === scope) return r;
  }
  return null;
}
