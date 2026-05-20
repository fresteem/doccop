/**
 * Style ID collision avoidance during snippet injection.
 *
 * Master and snippet `styles.xml` files typically share built-in style
 * IDs like `Heading1`, `Normal`, `TableNormal`. The visual definitions
 * may differ (snippet might define `Heading1` with a different font),
 * so simply merging the two style lists would let snippet rules win or
 * lose at random depending on order.
 *
 * Strategy: prefix every snippet style ID with a unique salt
 * (`s${counter}_`) and update every reference in the snippet body. The
 * snippet's local style definitions stay self-consistent; the master's
 * pre-existing styles are unaffected.
 *
 * What we look at:
 *  - `<w:style w:styleId="...">` (the style itself)
 *  - `<w:basedOn w:val="...">`, `<w:next w:val="...">`, `<w:link w:val="...">`
 *    inside `<w:style>` (intra-styles references)
 *  - `<w:pStyle w:val="...">`, `<w:rStyle w:val="...">`,
 *    `<w:tblStyle w:val="...">` in the body
 *
 * Out of scope (v1): docDefaults, latent style overrides, theme refs.
 * Those are rare in snippet content and rarely collide in practice.
 */

import type { Document } from "@xmldom/xmldom";
import { W_NS, findElements } from "../docx/xml-utils.js";

/** Result of a remap pass. */
export interface StyleRemapResult {
  /** Map of original style ID → new (prefixed) ID. */
  idMap: Map<string, string>;
  /** Number of body-element style references updated. */
  bodyRefsUpdated: number;
}

/**
 * Remap every style ID in `snippetStyles` to `${prefix}${original}`
 * and update every reference inside the snippet's `snippetBody` to
 * match.
 *
 * Both arguments are mutated in place. The caller is expected to pass
 * cloned documents.
 *
 * @param snippetStyles The snippet's parsed `word/styles.xml`. May be
 *   `null` if the snippet has no styles part — function then becomes
 *   a no-op on the styles side and only updates the body refs (which
 *   should also be absent, so result.bodyRefsUpdated will be 0).
 * @param snippetBody The snippet's parsed `word/document.xml`.
 * @param prefix Salt for the rename, e.g. `s1_`. Caller picks a value
 *   unique per snippet within a single render.
 */
export function remapSnippetStyles(
  snippetStyles: Document | null,
  snippetBody: Document,
  prefix: string,
): StyleRemapResult {
  const idMap = new Map<string, string>();
  let bodyRefsUpdated = 0;

  // 1. Walk every <w:style w:styleId="..."> and rename.
  if (snippetStyles) {
    const styles = findElements(snippetStyles, W_NS, "style");
    for (const style of styles) {
      const original = style.getAttributeNS(W_NS, "styleId");
      if (!original) continue;
      const renamed = `${prefix}${original}`;
      idMap.set(original, renamed);
      style.setAttributeNS(W_NS, "w:styleId", renamed);
    }

    // 2. Update intra-styles cross references.
    rewriteValReferences(snippetStyles, ["basedOn", "next", "link"], idMap);
  }

  // 3. Walk the snippet body and update every style reference.
  bodyRefsUpdated += rewriteValReferences(snippetBody, ["pStyle", "rStyle", "tblStyle"], idMap);

  return { idMap, bodyRefsUpdated };
}

/**
 * Find every element with the given local name and update its
 * `w:val` attribute via the rename map. Skips entries that aren't
 * in the map (i.e. references to master styles that the snippet
 * relies on implicitly — those continue to resolve in the merged
 * styles.xml).
 *
 * @returns the number of references updated.
 */
function rewriteValReferences(
  scope: Document,
  localNames: readonly string[],
  idMap: ReadonlyMap<string, string>,
): number {
  let count = 0;
  for (const localName of localNames) {
    const els = findElements(scope, W_NS, localName);
    for (const el of els) {
      const val = el.getAttributeNS(W_NS, "val");
      if (!val) continue;
      const renamed = idMap.get(val);
      if (renamed) {
        el.setAttributeNS(W_NS, "w:val", renamed);
        count++;
      }
    }
  }
  return count;
}

/**
 * Merge snippet styles into the master styles document. Snippet styles
 * are appended as new `<w:style>` children; their IDs are already
 * prefixed (caller ran `remapSnippetStyles` first), so collisions are
 * impossible.
 *
 * If the master has no styles document, the snippet's becomes the
 * master's. If the snippet has no styles document, the master is
 * unchanged.
 */
export function mergeStylesIntoMaster(
  masterStyles: Document | null,
  snippetStyles: Document | null,
): Document | null {
  if (!snippetStyles) return masterStyles;
  if (!masterStyles) return snippetStyles;

  const masterRoot = masterStyles.documentElement;
  if (!masterRoot) return masterStyles;

  // Snapshot snippet's `<w:style>` children before adopting them — the
  // node list iterator would otherwise drift as we mutate the source.
  const snippetStyleEls = findElements(snippetStyles, W_NS, "style");
  const toAppend: ReturnType<typeof findElements> = [];
  for (const el of snippetStyleEls) {
    if (el.parentNode === snippetStyles.documentElement) {
      toAppend.push(el);
    }
  }
  for (const el of toAppend) {
    // Move the node from snippet doc to master doc. xmldom's appendChild
    // re-parents transparently, but using importNode is safer because it
    // ensures the namespace declarations are honoured on the new owner.
    const imported = masterStyles.importNode(el, true);
    masterRoot.appendChild(imported);
  }
  return masterStyles;
}
