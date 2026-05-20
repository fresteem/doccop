/**
 * List-numbering ID collision avoidance during snippet injection.
 *
 * Word stores list definitions in two layers:
 *   - `<w:abstractNum w:abstractNumId="N">` — the abstract list format.
 *   - `<w:num w:numId="M">` — a concrete instance referencing an
 *     `abstractNumId`. The body refers to `numId` via
 *     `<w:numPr><w:numId w:val="M"/></w:numPr>`.
 *
 * Two snippets (or a snippet + the master) may use the same `numId` /
 * `abstractNumId` integers for different formats. We offset the
 * snippet's IDs above the master's highest values so no collisions
 * can occur, then merge.
 *
 * Strategy:
 *   1. Compute `numOffset` = (master's max numId) + 1.
 *   2. Compute `absOffset` = (master's max abstractNumId) + 1.
 *   3. Renumber every `<w:abstractNum>` and `<w:num>` in the snippet.
 *   4. Update every `<w:abstractNumId>` reference inside `<w:num>`.
 *   5. Update every `<w:numId>` reference in the snippet body.
 */

import type { Document } from "@xmldom/xmldom";
import { W_NS, findElements } from "../docx/xml-utils.js";

export interface NumberingRemapResult {
  /** Map of original numId → new numId. */
  numIdMap: Map<number, number>;
  /** Map of original abstractNumId → new abstractNumId. */
  abstractNumIdMap: Map<number, number>;
  /** Number of body `<w:numId>` references updated. */
  bodyRefsUpdated: number;
}

/**
 * Renumber snippet numbering definitions to avoid colliding with the
 * master's. Both numbering docs and the snippet body are mutated in
 * place; caller passes clones.
 */
export function remapSnippetNumbering(
  masterNumbering: Document | null,
  snippetNumbering: Document | null,
  snippetBody: Document,
): NumberingRemapResult {
  const result: NumberingRemapResult = {
    numIdMap: new Map(),
    abstractNumIdMap: new Map(),
    bodyRefsUpdated: 0,
  };

  if (!snippetNumbering) {
    // Snippet uses no numbering — still walk the body to make sure
    // there are no orphan refs (they'd be invalid in the master too).
    return result;
  }

  const numOffset = (masterMaxId(masterNumbering, "num", "numId") ?? 0) + 1;
  const absOffset = (masterMaxId(masterNumbering, "abstractNum", "abstractNumId") ?? 0) + 1;

  // 1. Renumber abstractNums.
  const absEls = findElements(snippetNumbering, W_NS, "abstractNum");
  for (const el of absEls) {
    const orig = el.getAttributeNS(W_NS, "abstractNumId");
    if (!orig || !/^\d+$/.test(orig)) continue;
    const next = Number.parseInt(orig, 10) + absOffset;
    result.abstractNumIdMap.set(Number.parseInt(orig, 10), next);
    el.setAttributeNS(W_NS, "w:abstractNumId", String(next));
  }

  // 2. Renumber nums + rewrite their abstractNumId refs.
  const numEls = findElements(snippetNumbering, W_NS, "num");
  for (const el of numEls) {
    const orig = el.getAttributeNS(W_NS, "numId");
    if (!orig || !/^\d+$/.test(orig)) continue;
    const next = Number.parseInt(orig, 10) + numOffset;
    result.numIdMap.set(Number.parseInt(orig, 10), next);
    el.setAttributeNS(W_NS, "w:numId", String(next));

    // <w:abstractNumId w:val="X"/> inside the num.
    const abRefs = findElements(el, W_NS, "abstractNumId");
    for (const abRef of abRefs) {
      if (abRef.parentNode !== el) continue;
      const refOrig = abRef.getAttributeNS(W_NS, "val");
      if (!refOrig || !/^\d+$/.test(refOrig)) continue;
      const mapped = result.abstractNumIdMap.get(Number.parseInt(refOrig, 10));
      if (mapped !== undefined) {
        abRef.setAttributeNS(W_NS, "w:val", String(mapped));
      }
    }
  }

  // 3. Update body references to numId.
  const bodyNumRefs = findElements(snippetBody, W_NS, "numId");
  for (const ref of bodyNumRefs) {
    const refOrig = ref.getAttributeNS(W_NS, "val");
    if (!refOrig || !/^\d+$/.test(refOrig)) continue;
    const mapped = result.numIdMap.get(Number.parseInt(refOrig, 10));
    if (mapped !== undefined) {
      ref.setAttributeNS(W_NS, "w:val", String(mapped));
      result.bodyRefsUpdated++;
    }
  }

  return result;
}

/**
 * Find the maximum value of an integer-typed attribute among all
 * occurrences of an element in the document. Returns `null` when the
 * document is missing or has no such elements.
 */
function masterMaxId(doc: Document | null, localName: string, attrName: string): number | null {
  if (!doc) return null;
  let max: number | null = null;
  const els = findElements(doc, W_NS, localName);
  for (const el of els) {
    const v = el.getAttributeNS(W_NS, attrName);
    if (!v || !/^\d+$/.test(v)) continue;
    const n = Number.parseInt(v, 10);
    if (max === null || n > max) max = n;
  }
  return max;
}

/**
 * Append snippet numbering definitions into the master document.
 * Snippet IDs are already offset, so no collision is possible.
 */
export function mergeNumberingIntoMaster(
  masterNumbering: Document | null,
  snippetNumbering: Document | null,
): Document | null {
  if (!snippetNumbering) return masterNumbering;
  if (!masterNumbering) return snippetNumbering;

  const masterRoot = masterNumbering.documentElement;
  if (!masterRoot) return masterNumbering;

  // Append abstractNums first, then nums — Word expects this order
  // inside `<w:numbering>`.
  const order: readonly string[] = ["abstractNum", "num"];
  for (const localName of order) {
    const els = findElements(snippetNumbering, W_NS, localName);
    for (const el of els) {
      if (el.parentNode !== snippetNumbering.documentElement) continue;
      const imported = masterNumbering.importNode(el, true);
      masterRoot.appendChild(imported);
    }
  }
  return masterNumbering;
}
