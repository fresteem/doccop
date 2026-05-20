/**
 * XML helpers for OOXML / .docx processing.
 *
 * `parseXmlSafely` is the only XML parser the engine uses. It performs an
 * XXE-prevention sweep (rejecting `<!ENTITY` declarations) before handing
 * the string to @xmldom/xmldom. @xmldom/xmldom does not resolve external
 * entities by design, but explicit rejection of `<!ENTITY` gives a clean
 * error code path and prevents future regressions if its defaults change.
 */

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document, Element } from "@xmldom/xmldom";
import { MalformedDocxError, XxeDetectedError } from "../errors.js";

/** Word's main wordprocessingml namespace URI. */
export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Word 2010+ extension namespace, where `paraId` and `textId` live. */
export const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";

/**
 * Map of namespace prefixes used inside OOXML document.xml. We declare
 * these on the root element when re-serialising so that prefixed
 * attributes survive the round-trip.
 */
export const OOXML_NAMESPACES: Readonly<Record<string, string>> = Object.freeze({
  w: W_NS,
  w14: W14_NS,
});

/**
 * Parse an XML string while rejecting external-entity declarations.
 *
 * @throws {XxeDetectedError} if the input contains `<!ENTITY` (DTD ignored).
 * @throws {MalformedDocxError} on syntactic XML errors.
 */
export function parseXmlSafely(xml: string, partName: string): Document {
  // Cheap textual scan before instantiating the parser. We don't try to
  // distinguish parameter entities, character entities, or comments —
  // OOXML never contains any `<!ENTITY` legitimately, so any occurrence
  // is rejected.
  const entityMatch = xml.match(/<!ENTITY\s+([%\s]*\w+)/);
  if (entityMatch) {
    throw new XxeDetectedError(entityMatch[1]?.trim() ?? "unknown");
  }

  let document: Document;
  let firstError: string | null = null;
  try {
    document = new DOMParser({
      onError: (level, msg) => {
        if (firstError === null && (level === "error" || level === "fatalError")) {
          firstError = msg;
        }
      },
    }).parseFromString(xml, "text/xml");
  } catch (err) {
    throw new MalformedDocxError(`failed to parse ${partName}`, err);
  }
  if (firstError !== null) {
    throw new MalformedDocxError(`failed to parse ${partName}: ${firstError}`);
  }
  return document;
}

/** Serialise a Document back to XML bytes (UTF-8) for inclusion in a zip. */
export function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

/**
 * Return every element in `doc` whose namespace URI is `nsUri` and whose
 * local name matches `localName`. xmldom's `getElementsByTagNameNS` returns
 * a live HTMLCollection; we copy into a plain array for predictable
 * iteration semantics.
 */
export function findElements(doc: Document | Element, nsUri: string, localName: string): Element[] {
  const live = doc.getElementsByTagNameNS(nsUri, localName);
  const out: Element[] = [];
  for (let i = 0; i < live.length; i++) {
    const item = live.item(i);
    if (item) out.push(item as Element);
  }
  return out;
}

/**
 * Ensure that `xmlns:<prefix>` is declared on the root element. xmldom
 * preserves namespace declarations encountered during parsing, but new
 * attributes inserted into a namespace need to be reachable through their
 * prefix or the serialised XML will be malformed.
 */
export function ensureNamespaceOnRoot(doc: Document, prefix: string, nsUri: string): void {
  const root = doc.documentElement;
  if (!root) return;
  if (root.getAttribute(`xmlns:${prefix}`) === nsUri) return;
  root.setAttribute(`xmlns:${prefix}`, nsUri);
}
