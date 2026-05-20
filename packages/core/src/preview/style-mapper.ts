/**
 * OOXML run/paragraph property → inline CSS translation.
 *
 * The preview renderer needs visible formatting without resolving Word's
 * full styles.xml inheritance chain. We map the most common direct
 * (i.e. `<w:rPr>`-applied) properties to inline CSS and leave styled
 * runs that rely only on `<w:pStyle>` / `<w:rStyle>` to render with
 * default formatting.
 *
 * This is intentional: the preview is for *editing placeholders*, not
 * for visually matching Word's render to the pixel. Wave-3 fidelity:
 * - run: bold, italic, underline, strike, font-size, colour
 * - paragraph: alignment, indentation
 * - text: tab, line break (via separate emit, not CSS)
 *
 * Future waves may add font-family mapping, list rendering, page breaks.
 */

import type { Element } from "@xmldom/xmldom";
import { W_NS, findElements } from "../docx/xml-utils.js";

/** Direct child lookup — `Element.getElementsByTagNameNS` recurses, we don't want that here. */
function findDirectChild(parent: Element, nsUri: string, localName: string): Element | null {
  const all = findElements(parent, nsUri, localName);
  for (const el of all) {
    if (el.parentNode === parent) return el;
  }
  return null;
}

/**
 * Translate a `<w:rPr>` element into an inline CSS string.
 * Returns the empty string when no recognised properties are present.
 */
export function runStyleToCss(rPr: Element | null): string {
  if (!rPr) return "";
  const parts: string[] = [];

  // <w:b/> — bold (presence-true; `<w:b w:val="0"/>` means explicitly off).
  if (isToggleSet(rPr, "b")) parts.push("font-weight:bold");
  if (isToggleSet(rPr, "i")) parts.push("font-style:italic");

  if (findDirectChild(rPr, W_NS, "u")) {
    const uEl = findDirectChild(rPr, W_NS, "u");
    const uVal = uEl?.getAttributeNS(W_NS, "val") ?? "single";
    // "none" is the canonical off-value; any other value is "on".
    if (uVal && uVal !== "none") parts.push("text-decoration:underline");
  }

  if (isToggleSet(rPr, "strike")) parts.push("text-decoration:line-through");

  // <w:sz w:val="22"/> — value is in half-points (so 22 → 11pt).
  const sz = findDirectChild(rPr, W_NS, "sz");
  const szVal = sz?.getAttributeNS(W_NS, "val");
  if (szVal && /^\d+$/.test(szVal)) {
    const halfPoints = Number.parseInt(szVal, 10);
    if (halfPoints > 0 && halfPoints < 200) {
      parts.push(`font-size:${(halfPoints / 2).toFixed(1)}pt`);
    }
  }

  // <w:color w:val="FF0000"/> — RGB hex without leading hash, or "auto".
  const color = findDirectChild(rPr, W_NS, "color");
  const colorVal = color?.getAttributeNS(W_NS, "val");
  if (colorVal && /^[0-9A-Fa-f]{6}$/.test(colorVal)) {
    parts.push(`color:#${colorVal}`);
  }

  return parts.join(";");
}

/**
 * Translate a `<w:pPr>` element into an inline CSS string.
 */
export function paraStyleToCss(pPr: Element | null): string {
  if (!pPr) return "";
  const parts: string[] = [];

  // <w:jc w:val="left|center|right|both|distribute"/> — alignment.
  const jc = findDirectChild(pPr, W_NS, "jc");
  const jcVal = jc?.getAttributeNS(W_NS, "val");
  switch (jcVal) {
    case "center":
      parts.push("text-align:center");
      break;
    case "right":
    case "end":
      parts.push("text-align:right");
      break;
    case "both":
    case "distribute":
      parts.push("text-align:justify");
      break;
    case "left":
    case "start":
      parts.push("text-align:left");
      break;
    default:
      // No or unknown alignment → inherit.
      break;
  }

  // <w:ind w:left="720"/> — indentation in twips (1/20 of a point).
  const ind = findDirectChild(pPr, W_NS, "ind");
  if (ind) {
    const leftTwips = ind.getAttributeNS(W_NS, "left") ?? ind.getAttributeNS(W_NS, "start");
    if (leftTwips && /^\d+$/.test(leftTwips)) {
      const pt = Number.parseInt(leftTwips, 10) / 20;
      parts.push(`margin-left:${pt.toFixed(1)}pt`);
    }
  }

  return parts.join(";");
}

/**
 * A boolean toggle property in OOXML may be:
 *   `<w:b/>`               → explicitly true
 *   `<w:b w:val="true"/>`  → true
 *   `<w:b w:val="1"/>`     → true
 *   `<w:b w:val="false"/>` → false
 *   `<w:b w:val="0"/>`     → false
 * Anything else (including absence) → false.
 */
function isToggleSet(parent: Element, localName: string): boolean {
  const el = findDirectChild(parent, W_NS, localName);
  if (!el) return false;
  const val = el.getAttributeNS(W_NS, "val");
  if (val === null || val === "") return true;
  return val !== "0" && val !== "false";
}
