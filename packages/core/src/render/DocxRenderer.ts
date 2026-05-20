/**
 * Variable substitution renderer.
 *
 * Walks every placeholder (SDT) in a template, resolves its value
 * through the configured `EntityResolver`s, validates the result
 * against the placeholder's declared data type, and substitutes the
 * value into the SDT content via `PlaceholderEngine.replace`.
 *
 * Two modes:
 * - strict (default `true`): missing resolver / absent value / type
 *   validation failure → throws. The engine guarantees an all-or-
 *   nothing result.
 * - non-strict: collects warnings, substitutes a marker text for
 *   missing values, succeeds. Useful for preview-time draft renders.
 *
 * What this Wave does NOT do (yet):
 * - Image substitution (`ResolvedValue.kind === "image"`) — surfaces a
 *   warning, falls back to absent behaviour.
 * - Requisites block injection — surfaces a `snippet_missing` warning.
 *   Wave 6 (`RequisitesEngine`) lands the XML injection that turns the
 *   warning branch into actual snippet rendering.
 */

import { serialize } from "../docx/DocxParser.js";
import type { DocxArchive } from "../docx/types.js";
import {
  AbsentValueInStrictModeError,
  NoResolverForScopeError,
  ResolverFailedError,
} from "../errors.js";
import { list, replace } from "../placeholders/PlaceholderEngine.js";
import { decomposeTag } from "../placeholders/TagValidator.js";
import { resolveAndInject } from "../requisites/RequisitesEngine.js";
import type {
  DataType,
  EntityResolver,
  RenderResult,
  RenderWarning,
  ResolvedValue,
} from "../types.js";
import { buildResolveContext, findResolver } from "./VariableContext.js";
import { validateValue } from "./typeValidators.js";
import type { RenderConfig, RenderRequest } from "./types.js";

/** Render-internal placeholder catalogue entry — what we plan to substitute. */
interface PendingSubstitution {
  tag: string;
  scope: string;
  key: string;
  dataType: DataType;
  /** Final string to inject. `null` for tags we leave alone (requisites in Wave 5). */
  value: string | null;
}

/**
 * Render the template by walking every SDT, resolving its value, and
 * substituting the result.
 *
 * The input `template` archive is NOT mutated. Resolution failures in
 * strict mode throw before any mutation happens (we don't ship partial
 * renders).
 */
export async function render(
  template: DocxArchive,
  req: RenderRequest,
  config: RenderConfig,
  dataTypes: ReadonlyMap<string, DataType> = new Map(),
): Promise<RenderResult> {
  const t0 = Date.now();
  const strict = config.options?.strict !== false; // default true
  const ctx = buildResolveContext(req, req.templateCategory);

  const warnings: RenderWarning[] = [];
  const resolved: Record<string, string> = {};

  // ── Phase 1: Requisites injection ──────────────────────────────────────
  // Block-level `requisites:party_*` SDTs must be expanded into snippet
  // content before we resolve the rest of the document, because injected
  // snippet paragraphs may themselves carry value placeholders that pass
  // 2 will need to substitute.
  let current = template;
  let stylePrefixCounter = 0;
  const requisitesPlaceholders = list(current, dataTypes).filter(
    (p) => decomposeTag(p.tag).kind === "requisites",
  );
  for (const ph of requisitesPlaceholders) {
    const decomposed = decomposeTag(ph.tag);
    if (decomposed.kind !== "requisites") continue; // narrowing
    const targetParty = decomposed.partyRole;
    const party = ctx.parties[targetParty];
    if (!party) {
      if (strict) {
        throw new AbsentValueInStrictModeError(
          ph.tag,
          `no party '${targetParty}' in render request`,
        );
      }
      warnings.push({
        kind: "snippet_missing",
        tag: ph.tag,
        detail: `no party '${targetParty}'`,
      });
      continue;
    }
    // Look up the entity subtype via the party's regular resolver. The
    // host's OrganizationsResolver convention: `subtype` returns the
    // legal-entity form code (TOV/FOP/PP/…).
    const partyResolver = findResolver(config.resolvers, targetParty as EntityResolver["scope"]);
    let entitySubtype: string | null = null;
    if (partyResolver) {
      try {
        const sub = await partyResolver.resolve("subtype", ctx);
        if (sub.kind === "text") entitySubtype = sub.value;
      } catch (err) {
        if (strict) throw new ResolverFailedError(ph.tag, err);
        warnings.push({
          kind: "snippet_missing",
          tag: ph.tag,
          detail: `resolver for '${targetParty}.subtype' threw: ${String(err)}`,
        });
        continue;
      }
    }
    stylePrefixCounter++;
    const stylePrefix = `s${stylePrefixCounter}_`;
    const result = await resolveAndInject({
      master: current,
      tag: ph.tag,
      targetParty,
      entityType: party.entityType,
      entitySubtype,
      resolver: config.requisitesResolver,
      renderRequest: req,
      renderConfig: config,
      ...(dataTypes.size > 0 ? { dataTypes } : {}),
      stylePrefix,
      strict,
    });
    if (result.skipped) {
      warnings.push({
        kind: "snippet_missing",
        tag: ph.tag,
        detail: result.reason ?? "skipped",
      });
    }
    current = result.master;
  }

  // ── Phase 2: Value-placeholder resolution ──────────────────────────────
  // After requisites injection, re-list placeholders so we see any new
  // SDTs that came from injected snippet bodies.
  const placeholders = list(current, dataTypes);
  const pending: PendingSubstitution[] = [];

  // ── Resolution pass: collect everything before mutating ────────────────
  for (const ph of placeholders) {
    const decomposed = decomposeTag(ph.tag);

    if (decomposed.kind === "requisites") {
      // Skipped during Phase 1 (non-strict) — leave in place with warning.
      pending.push({
        tag: ph.tag,
        scope: ph.scope,
        key: ph.key,
        dataType: ph.dataType,
        value: null,
      });
      continue;
    }

    // ── Value placeholder ──────────────────────────────────────────────
    const resolver = findResolver(config.resolvers, decomposed.scope);
    if (!resolver) {
      if (strict) throw new NoResolverForScopeError(decomposed.scope, ph.tag);
      warnings.push({
        kind: "missing_resolver",
        tag: ph.tag,
        detail: `no resolver registered for scope '${decomposed.scope}'`,
      });
      pending.push({ ...phMeta(ph), value: missingMarker(ph.tag) });
      continue;
    }

    let value: ResolvedValue;
    try {
      value = await resolver.resolve(decomposed.key, ctx);
    } catch (err) {
      if (strict) throw new ResolverFailedError(ph.tag, err);
      warnings.push({
        kind: "missing_resolver",
        tag: ph.tag,
        detail: `resolver threw: ${String(err)}`,
      });
      pending.push({ ...phMeta(ph), value: missingMarker(ph.tag) });
      continue;
    }

    switch (value.kind) {
      case "text": {
        let validated: string;
        try {
          validated = validateValue(ph.dataType, ph.tag, value.value);
        } catch (err) {
          if (strict) throw err;
          warnings.push({
            kind: "type_mismatch",
            tag: ph.tag,
            detail: String(err),
          });
          pending.push({ ...phMeta(ph), value: missingMarker(ph.tag) });
          continue;
        }
        resolved[ph.tag] = validated;
        pending.push({ ...phMeta(ph), value: validated });
        break;
      }
      case "image":
        // Wave-5 limitation: image substitution requires DrawingML wiring
        // we haven't built yet. Treat as absent.
        warnings.push({
          kind: "absent_value",
          tag: ph.tag,
          detail: "image substitution not implemented in v1",
        });
        if (strict) {
          throw new AbsentValueInStrictModeError(ph.tag, "image substitution not supported");
        }
        pending.push({ ...phMeta(ph), value: missingMarker(ph.tag) });
        break;
      case "absent":
        if (strict) {
          throw new AbsentValueInStrictModeError(ph.tag, value.reason);
        }
        warnings.push({
          kind: "absent_value",
          tag: ph.tag,
          detail: value.reason ?? "resolver returned absent",
        });
        pending.push({ ...phMeta(ph), value: missingMarker(ph.tag) });
        break;
    }
  }

  // ── Substitution pass: apply mutations on the working archive ─────────
  // `current` already carries any requisites snippets that Phase 1 injected.
  for (const sub of pending) {
    if (sub.value === null) continue; // requisites left alone (skipped in non-strict)
    current = replace(current, sub.tag, sub.value);
  }

  const docxBytes = serialize(current);
  return {
    docx: docxBytes,
    resolvedValues: resolved,
    warnings,
    durationMs: Date.now() - t0,
  };
}

function phMeta(ph: { tag: string; scope: string; key: string; dataType: DataType }) {
  return { tag: ph.tag, scope: ph.scope, key: ph.key, dataType: ph.dataType };
}

/**
 * The marker text we substitute into a placeholder in non-strict mode
 * when no value is available. Kept distinctive so it's visually
 * obvious in the rendered output that something is missing.
 */
function missingMarker(tag: string): string {
  return `{missing: ${tag}}`;
}

/**
 * Exposed only for tests that want to round-trip the resolver routing
 * without doing the full render dance.
 */
export { findResolver };
/** Test/debug helper — list resolvers' scopes in registration order. */
export function listResolverScopes(resolvers: readonly EntityResolver[]): string[] {
  return resolvers.map((r) => r.scope);
}
