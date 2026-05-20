/**
 * Block-level SDT → snippet body splice.
 *
 * Once the snippet has been rendered (placeholders resolved) and its
 * styles/numbering/bookmarks have been remapped to avoid collision,
 * we replace the block-level `<w:sdt>` in the master with the
 * snippet's paragraphs (and tables) — the SDT marker disappears, the
 * substituted content takes its place.
 *
 * Steps:
 *   1. Locate every `<w:sdt>` in the master whose tag matches the
 *      target (e.g. `requisites:party_a`). Throw if none found —
 *      that's a placeholder validation bug, not an injection bug.
 *   2. For each match:
 *      a. Snapshot the snippet body's top-level block elements
 *         (`<w:p>`, `<w:tbl>`) in document order.
 *      b. Replace the `<w:sdt>` with these elements, importing them
 *         into the master document so namespace owners line up.
 *   3. Mutations are in place on the master document.
 */

import type { Document, Element, Node } from "@xmldom/xmldom";
import { W_NS, findElements } from "../docx/xml-utils.js";
import { PlaceholderNotFoundError } from "../errors.js";

/**
 * Replace each occurrence of the SDT carrying `tag` in `masterDoc`
 * with the block-level children of the snippet body.
 *
 * @throws {PlaceholderNotFoundError} when no matching SDT is present.
 *   The caller is expected to call this only when render confirmed
 *   the placeholder exists.
 */
export function injectSnippetBody(masterDoc: Document, snippetBody: Document, tag: string): void {
  const targets = locateBlockSdts(masterDoc, tag);
  if (targets.length === 0) {
    throw new PlaceholderNotFoundError(tag);
  }

  // We capture the snippet's block elements once. Each match gets its
  // own deep clone — Word semantics expect identical content at every
  // anchor; cloning ensures every output has its own node identity.
  const blocks = collectSnippetBlocks(snippetBody);

  for (const sdt of targets) {
    const parent = sdt.parentNode;
    if (!parent) continue;
    // Insert clones in document order, before the SDT.
    for (const block of blocks) {
      const imported = masterDoc.importNode(block.cloneNode(true), true);
      parent.insertBefore(imported, sdt);
    }
    parent.removeChild(sdt);
  }
}

/**
 * Walk the master document and return every `<w:sdt>` whose
 * `<w:sdtPr><w:tag w:val="...">` matches `tag`. Block SDTs sit
 * between paragraphs at the body level, so we restrict the scan to
 * matches that are NOT inside a `<w:p>` (those would be inline SDTs,
 * which Wave 5's `DocxRenderer.replace` already handles).
 */
function locateBlockSdts(masterDoc: Document, tag: string): Element[] {
  const out: Element[] = [];
  for (const sdt of findElements(masterDoc, W_NS, "sdt")) {
    if (isInsideParagraph(sdt)) continue;
    const sdtPr = directChildByName(sdt, W_NS, "sdtPr");
    if (!sdtPr) continue;
    const tagEl = directChildByName(sdtPr, W_NS, "tag");
    if (!tagEl) continue;
    const val = tagEl.getAttributeNS(W_NS, "val");
    if (val === tag) out.push(sdt);
  }
  return out;
}

function isInsideParagraph(el: Element): boolean {
  let cur: Node | null = el.parentNode;
  while (cur && cur.nodeType === 1) {
    const e = cur as Element;
    if (e.namespaceURI === W_NS && e.localName === "p") return true;
    cur = cur.parentNode;
  }
  return false;
}

function directChildByName(parent: Element, nsUri: string, localName: string): Element | null {
  let n: Node | null = parent.firstChild;
  while (n) {
    if (n.nodeType === 1) {
      const e = n as Element;
      if (e.namespaceURI === nsUri && e.localName === localName) return e;
    }
    n = n.nextSibling;
  }
  return null;
}

/**
 * Pull the snippet body's top-level block elements (`<w:p>`, `<w:tbl>`)
 * out of `<w:body>` in document order. Other body children (sectPr,
 * bookmarkRangeStart, etc.) are skipped — sectPr is master-document
 * concerns; bookmarks should already be remapped and would be part of
 * `<w:p>` content when they matter.
 */
function collectSnippetBlocks(snippetBody: Document): Element[] {
  const root = snippetBody.documentElement;
  if (!root) return [];
  const bodies = findElements(root, W_NS, "body");
  const body = bodies[0];
  if (!body) return [];

  const blocks: Element[] = [];
  let n: Node | null = body.firstChild;
  while (n) {
    if (n.nodeType === 1) {
      const e = n as Element;
      if (e.namespaceURI === W_NS && (e.localName === "p" || e.localName === "tbl")) {
        blocks.push(e);
      }
    }
    n = n.nextSibling;
  }
  return blocks;
}
