/**
 * Bookmark ID rerandomization for snippet injection.
 *
 * Word stores bookmarks as paired `<w:bookmarkStart>` /
 * `<w:bookmarkEnd>` elements with an integer `w:id` linking the two.
 * Two snippets in a single document, or a snippet and the master,
 * may use the same integer for different bookmarks — Word doesn't
 * complain on save, but cross-reference fields and table-of-contents
 * entries would resolve to the wrong target.
 *
 * Strategy: pick a fresh random integer for each `w:bookmarkStart` in
 * the snippet body, mirror it on the matching `w:bookmarkEnd`. Names
 * (`w:name`) are NOT rewritten — they're authored deliberately by the
 * snippet creator and may be referenced from elsewhere.
 */

import { randomInt } from "node:crypto";
import type { Document } from "@xmldom/xmldom";
import { W_NS, findElements } from "../docx/xml-utils.js";

/** Result of the remap pass. */
export interface BookmarkRemapResult {
  /** Map of original `w:id` → new `w:id`. */
  idMap: Map<string, string>;
  /** Number of `bookmarkEnd` elements whose id we updated. */
  endsUpdated: number;
}

/**
 * Rerandomize bookmark IDs in `snippetBody`. Mutates in place.
 *
 * IDs are random 31-bit positive integers — large enough that
 * collision with master's existing bookmark IDs is astronomically
 * unlikely, even at thousands of merges.
 */
export function remapSnippetBookmarks(snippetBody: Document): BookmarkRemapResult {
  const result: BookmarkRemapResult = {
    idMap: new Map(),
    endsUpdated: 0,
  };

  const starts = findElements(snippetBody, W_NS, "bookmarkStart");
  for (const start of starts) {
    const oldId = start.getAttributeNS(W_NS, "id");
    if (!oldId) continue;
    const newId = String(randomInt(1, 0x7fffffff));
    result.idMap.set(oldId, newId);
    start.setAttributeNS(W_NS, "w:id", newId);
  }

  const ends = findElements(snippetBody, W_NS, "bookmarkEnd");
  for (const end of ends) {
    const oldId = end.getAttributeNS(W_NS, "id");
    if (!oldId) continue;
    const mapped = result.idMap.get(oldId);
    if (mapped) {
      end.setAttributeNS(W_NS, "w:id", mapped);
      result.endsUpdated++;
    }
  }

  return result;
}
