/**
 * Block-level requisites injection — the public entry point that the
 * `DocxRenderer` calls when it encounters a `requisites:party_*` SDT.
 *
 * The pipeline:
 *   1. Look up the target party's entity → `(entityType, entitySubtype)`.
 *   2. Ask the configured `RequisitesResolver` for a matching snippet.
 *   3. Parse the snippet bytes into a `DocxArchive`.
 *   4. Rewrite the snippet's bare-key tags to `party_X.<key>` so the
 *      standard resolver routing applies.
 *   5. Render the snippet's placeholders via `DocxRenderer.render` —
 *      this gives us a fully-substituted snippet body.
 *   6. Remap snippet styles / numbering / bookmarks to avoid colliding
 *      with the master document.
 *   7. Replace the master's block SDT with the snippet's body
 *      paragraphs and merge the auxiliary parts back.
 *
 * If steps 2 or 3 fail (no snippet, malformed docx), the function
 * throws — in strict mode the renderer surfaces this; in non-strict
 * mode it converts to a warning.
 */

import { ensureParaIds } from "../docx/AnchorMapper.js";
import { parse, serialize } from "../docx/DocxParser.js";
import type { DocxArchive } from "../docx/types.js";
import { parseXmlSafely, serializeXml } from "../docx/xml-utils.js";
import { AbsentValueInStrictModeError } from "../errors.js";
import { render } from "../render/DocxRenderer.js";
import type { RenderConfig, RenderRequest } from "../render/types.js";
import type { DataType, RequisitesResolver, TemplateSnippet } from "../types.js";
import { remapSnippetBookmarks } from "./BookmarkRemapper.js";
import { mergeNumberingIntoMaster, remapSnippetNumbering } from "./NumberingRemapper.js";
import { parseAuxiliaryParts, writeAuxiliaryParts } from "./SnippetArchive.js";
import { mergeStylesIntoMaster, remapSnippetStyles } from "./StyleRemapper.js";
import { rewriteSnippetTags } from "./TagRewriter.js";
import { injectSnippetBody } from "./XmlInjector.js";

/**
 * Inputs the renderer hands to the requisites pipeline.
 */
export interface InjectionRequest {
  /** Master archive — will be returned mutated (clone first if caller cares). */
  master: DocxArchive;
  /** Tag of the block SDT to replace, e.g. `requisites:party_a`. */
  tag: string;
  /** Party slot the SDT addresses, e.g. `party_a`. */
  targetParty: string;
  /** Resolved snippet from `RequisitesResolver`. */
  snippet: TemplateSnippet;
  /** Render request — passed through so snippet placeholders see meta. */
  renderRequest: RenderRequest;
  /** Render config — resolvers are reused for the snippet pass. */
  renderConfig: RenderConfig;
  /** Per-tag data types for the snippet's placeholders. */
  dataTypes?: ReadonlyMap<string, DataType>;
  /**
   * Salt for style ID renaming. The caller bumps this per snippet
   * within a single render so two snippets sharing style names don't
   * collide after both are merged.
   */
  stylePrefix: string;
}

/**
 * Run the full injection pipeline. Returns a new archive with the
 * master's block SDT replaced by the snippet content and auxiliary
 * parts merged.
 */
export async function injectRequisites(req: InjectionRequest): Promise<DocxArchive> {
  // ── 1-3. Parse snippet, normalise paraIds, rewrite bare-key tags ──────
  // Snippets authored outside Word may carry non-hex paraIds (or none at
  // all). PlaceholderEngine.list() requires the canonical 8-hex form to
  // surface SDTs, so we run ensureParaIds before anything else looks at
  // the document.
  const snippetArchive = parse(req.snippet.bytes);
  ensureParaIds(snippetArchive);
  const rewriteCount = rewriteSnippetTags(snippetArchive, req.targetParty);
  // `rewriteCount` is informational — DocxRenderer will raise if a
  // rewritten tag points at an absent resolver/key.
  void rewriteCount;

  // ── 4. Render snippet placeholders ─────────────────────────────────────
  // The snippet is rendered standalone with the same resolvers — the
  // body comes back as docx bytes with placeholders substituted.
  const rendered = await render(snippetArchive, req.renderRequest, req.renderConfig, req.dataTypes);
  const renderedSnippet = parse(rendered.docx);

  // ── 5. Parse master + snippet auxiliary parts ──────────────────────────
  const masterAux = parseAuxiliaryParts(req.master);
  const snippetAux = parseAuxiliaryParts(renderedSnippet);

  // ── 6a. Style remap ────────────────────────────────────────────────────
  remapSnippetStyles(snippetAux.styles, renderedSnippet.document, req.stylePrefix);

  // ── 6b. Numbering remap ────────────────────────────────────────────────
  remapSnippetNumbering(masterAux.numbering, snippetAux.numbering, renderedSnippet.document);

  // ── 6c. Bookmark rerandomize ───────────────────────────────────────────
  remapSnippetBookmarks(renderedSnippet.document);

  // ── 7. Splice snippet body into master ─────────────────────────────────
  // Walk through the master via a fresh DOM (so the input archive is
  // untouched). We round-trip via serialize/parseXmlSafely — slightly
  // slower than cloneNode but guarantees a clean DOM with no shared
  // node identities.
  const masterXml = serializeXml(req.master.document);
  const masterDoc = parseXmlSafely(masterXml, "word/document.xml");
  injectSnippetBody(masterDoc, renderedSnippet.document, req.tag);

  // ── 8. Merge auxiliary parts back into the master ──────────────────────
  const mergedStyles = mergeStylesIntoMaster(masterAux.styles, snippetAux.styles);
  const mergedNumbering = mergeNumberingIntoMaster(masterAux.numbering, snippetAux.numbering);

  const next: DocxArchive = {
    document: masterDoc,
    rawParts: req.master.rawParts,
  };
  return writeAuxiliaryParts(next, {
    styles: mergedStyles,
    numbering: mergedNumbering,
  });
}

/**
 * Helper that the `DocxRenderer` calls when it needs to fetch and
 * inject a snippet for a particular block placeholder. Catches the
 * "no resolver" / "no snippet" cases and routes them through the
 * standard strict-mode error path.
 */
export async function resolveAndInject(opts: {
  master: DocxArchive;
  tag: string;
  targetParty: string;
  entityType: string;
  entitySubtype: string | null;
  resolver: RequisitesResolver | undefined;
  renderRequest: RenderRequest;
  renderConfig: RenderConfig;
  dataTypes?: ReadonlyMap<string, DataType>;
  stylePrefix: string;
  strict: boolean;
}): Promise<{ master: DocxArchive; skipped: boolean; reason?: string }> {
  if (!opts.resolver) {
    if (opts.strict) {
      throw new AbsentValueInStrictModeError(opts.tag, "no requisitesResolver configured");
    }
    return { master: opts.master, skipped: true, reason: "no requisitesResolver configured" };
  }
  if (!opts.entitySubtype) {
    if (opts.strict) {
      throw new AbsentValueInStrictModeError(
        opts.tag,
        `party '${opts.targetParty}' has no entitySubtype`,
      );
    }
    return {
      master: opts.master,
      skipped: true,
      reason: `party '${opts.targetParty}' has no entitySubtype`,
    };
  }
  const snippet = await opts.resolver.resolveSnippet(opts.entityType, opts.entitySubtype);
  if (!snippet) {
    if (opts.strict) {
      throw new AbsentValueInStrictModeError(
        opts.tag,
        `no snippet for ${opts.entityType}/${opts.entitySubtype}`,
      );
    }
    return {
      master: opts.master,
      skipped: true,
      reason: `no snippet for ${opts.entityType}/${opts.entitySubtype}`,
    };
  }

  const injected = await injectRequisites({
    master: opts.master,
    tag: opts.tag,
    targetParty: opts.targetParty,
    snippet,
    renderRequest: opts.renderRequest,
    renderConfig: opts.renderConfig,
    ...(opts.dataTypes ? { dataTypes: opts.dataTypes } : {}),
    stylePrefix: opts.stylePrefix,
  });
  return { master: injected, skipped: false };
}

// Re-export for the public barrel.
export { rewriteSnippetTags } from "./TagRewriter.js";

/**
 * Tiny convenience for callers wanting to serialise an archive after
 * injection without importing `DocxParser` separately.
 */
export function serializeArchive(archive: DocxArchive): Uint8Array {
  return serialize(archive);
}
