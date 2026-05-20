/**
 * Helpers for working with `<w:r>` runs during placeholder wrap/unwrap.
 *
 * The wrap operation often needs to split a run mid-text: if the user
 * selects "Company" inside the run "ABC Company Ltd", we must produce
 * three runs ("ABC ", SDT-wrapped "Company", " Ltd") with the original
 * `<w:rPr>` formatting carried over to each piece.
 *
 * Constraints for v1 (Wave 4):
 * - A run is assumed to contain at most ONE `<w:t>` text element.
 * - Runs that contain tabs, line breaks, fields, or other non-text
 *   content cannot be split. Selections that would require splitting
 *   such a run are rejected upstream with a clear error.
 *
 * Walking real Word documents shows ~95% of runs satisfy these
 * constraints; complex cases are an explicit "v2" extension point.
 */

import type { Element, Node } from "@xmldom/xmldom";
import { W_NS, findElements } from "../docx/xml-utils.js";

/** Direct (non-recursive) children of an element. */
export function* directChildren(parent: Element): Generator<Element> {
  let n: Node | null = parent.firstChild;
  while (n) {
    if (n.nodeType === 1) yield n as Element;
    n = n.nextSibling;
  }
}

/** First direct child element with the given namespace + local name. */
export function directChild(parent: Element, nsUri: string, localName: string): Element | null {
  for (const c of directChildren(parent)) {
    if (c.namespaceURI === nsUri && c.localName === localName) return c;
  }
  return null;
}

/**
 * Return all `<w:r>` direct children of the paragraph, in document
 * order. Runs that are children of an SDT inside the paragraph are NOT
 * included (those belong to that SDT's content scope).
 */
export function listDirectRuns(paragraph: Element): Element[] {
  const out: Element[] = [];
  for (const c of directChildren(paragraph)) {
    if (c.namespaceURI === W_NS && c.localName === "r") out.push(c);
  }
  return out;
}

/** Return direct `<w:sdt>` children of the paragraph. */
export function listDirectSdts(paragraph: Element): Element[] {
  const out: Element[] = [];
  for (const c of directChildren(paragraph)) {
    if (c.namespaceURI === W_NS && c.localName === "sdt") out.push(c);
  }
  return out;
}

/**
 * Extract the run's text content. Returns the concatenated character
 * data of every `<w:t>` element inside the run (the engine treats the
 * run as if it has one logical text payload).
 */
export function runText(run: Element): string {
  let s = "";
  for (const t of findElements(run, W_NS, "t")) {
    let n: Node | null = t.firstChild;
    while (n) {
      if (n.nodeType === 3) s += n.nodeValue ?? "";
      n = n.nextSibling;
    }
  }
  return s;
}

/**
 * True if the run has exactly one `<w:t>` element and no other content
 * children (tabs, breaks, fields). Wrap-time splits require this; runs
 * that fail the check must be wrapped whole or excluded from the
 * selection.
 */
export function isSimpleRun(run: Element): boolean {
  let tCount = 0;
  for (const c of directChildren(run)) {
    if (c.namespaceURI !== W_NS) continue;
    if (c.localName === "rPr") continue;
    if (c.localName === "t") {
      tCount++;
      if (tCount > 1) return false;
      continue;
    }
    // Any other w:* child (tab, br, fldChar, sym, …) disqualifies splits.
    return false;
  }
  return tCount === 1;
}

/**
 * Split a simple run at the given character offset.
 *
 * @returns A pair of newly created runs. Both have a deep-cloned copy
 *   of the original `<w:rPr>` (if any), and each carries its half of
 *   the text. Neither replaces the original in the tree — the caller
 *   inserts them where appropriate.
 *
 * @throws Error if `run` is not simple.
 */
export function splitSimpleRun(run: Element, offset: number): [Element, Element] {
  if (!isSimpleRun(run)) {
    throw new Error("splitSimpleRun: run is not simple (contains tabs/breaks/multiple texts)");
  }
  const text = runText(run);
  if (offset < 0 || offset > text.length) {
    throw new Error(`splitSimpleRun: offset ${offset} out of range 0..${text.length}`);
  }
  const leftText = text.slice(0, offset);
  const rightText = text.slice(offset);

  const doc = run.ownerDocument;
  if (!doc) throw new Error("splitSimpleRun: run has no owner document");

  // Clone the original twice — gives us identical rPr on both halves.
  const left = run.cloneNode(true) as Element;
  const right = run.cloneNode(true) as Element;
  setRunText(left, leftText);
  setRunText(right, rightText);
  return [left, right];
}

/**
 * Replace the run's `<w:t>` content with the given string, preserving
 * `xml:space="preserve"` so leading/trailing whitespace survives. If
 * the run has no `<w:t>` element, one is created after any `<w:rPr>`.
 */
export function setRunText(run: Element, text: string): void {
  const doc = run.ownerDocument;
  if (!doc) throw new Error("setRunText: run has no owner document");
  // Drop existing <w:t> elements.
  for (const t of findElements(run, W_NS, "t")) {
    t.parentNode?.removeChild(t);
  }
  // Create a fresh <w:t> with preserved whitespace.
  const t = doc.createElementNS(W_NS, "w:t");
  t.setAttribute("xml:space", "preserve");
  t.appendChild(doc.createTextNode(text));
  run.appendChild(t);
}

/**
 * Insert `newNode` directly after `referenceNode` in the parent. Mirrors
 * the DOM standard `referenceNode.after(newNode)` for environments where
 * `Element.after` is unavailable (xmldom does not implement it).
 */
export function insertAfter(referenceNode: Element, newNode: Element): void {
  const parent = referenceNode.parentNode;
  if (!parent) throw new Error("insertAfter: reference node has no parent");
  const next = referenceNode.nextSibling;
  if (next) {
    parent.insertBefore(newNode, next);
  } else {
    parent.appendChild(newNode);
  }
}
