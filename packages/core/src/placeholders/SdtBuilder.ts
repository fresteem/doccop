/**
 * Construction of `<w:sdt>` elements from validated tag + alias inputs.
 *
 * Output shape (matches what Microsoft Word writes when you insert a
 * content control via the ribbon):
 *
 *   <w:sdt>
 *     <w:sdtPr>
 *       <w:tag w:val="party_a.full_name"/>
 *       <w:alias w:val="Сторона А — повна назва"/>
 *       <w:lock w:val="contentLocked"/>
 *     </w:sdtPr>
 *     <w:sdtContent>...wrapped runs go here...</w:sdtContent>
 *   </w:sdt>
 *
 * `contentLocked` prevents users from editing the wrapped value
 * directly in Word — they go through our editor to change the binding.
 * The actual displayed text comes from whatever runs we move into
 * sdtContent; at render time DocxRenderer (Wave 5) replaces it.
 */

import type { Document, Element } from "@xmldom/xmldom";
import { W_NS } from "../docx/xml-utils.js";

export interface BuildSdtOptions {
  tag: string;
  alias: string;
}

/**
 * Build a new `<w:sdt>` element ready to receive content runs. The
 * returned element is detached from the tree — the caller appends
 * content into `getSdtContent(sdt)` then inserts the SDT into its
 * destination.
 */
export function buildSdt(doc: Document, opts: BuildSdtOptions): Element {
  const sdt = doc.createElementNS(W_NS, "w:sdt");
  const sdtPr = doc.createElementNS(W_NS, "w:sdtPr");
  sdt.appendChild(sdtPr);

  const tagEl = doc.createElementNS(W_NS, "w:tag");
  tagEl.setAttributeNS(W_NS, "w:val", opts.tag);
  sdtPr.appendChild(tagEl);

  const aliasEl = doc.createElementNS(W_NS, "w:alias");
  aliasEl.setAttributeNS(W_NS, "w:val", opts.alias);
  sdtPr.appendChild(aliasEl);

  const lockEl = doc.createElementNS(W_NS, "w:lock");
  lockEl.setAttributeNS(W_NS, "w:val", "contentLocked");
  sdtPr.appendChild(lockEl);

  const sdtContent = doc.createElementNS(W_NS, "w:sdtContent");
  sdt.appendChild(sdtContent);

  return sdt;
}

/** Return the `<w:sdtContent>` child of an `<w:sdt>` (must exist). */
export function getSdtContent(sdt: Element): Element {
  let n = sdt.firstChild;
  while (n) {
    if (n.nodeType === 1) {
      const el = n as Element;
      if (el.namespaceURI === W_NS && el.localName === "sdtContent") return el;
    }
    n = n.nextSibling;
  }
  throw new Error("getSdtContent: <w:sdt> has no <w:sdtContent> child");
}
