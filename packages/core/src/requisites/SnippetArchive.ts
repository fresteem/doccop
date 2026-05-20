/**
 * Snippet-level helpers around `DocxArchive`.
 *
 * Requisites snippets are themselves `.docx` files with their own
 * `styles.xml`, `numbering.xml`, and `_rels/document.xml.rels` parts.
 * When the engine injects a snippet body into a master, it must MERGE
 * these auxiliary parts — which means parsing them out of `rawParts`,
 * mutating them as needed, and writing the merged versions back.
 *
 * For Waves 2-5 the engine only ever touched `document.xml`, so
 * `DocxArchive.rawParts` held all the other parts as opaque bytes.
 * This module re-hydrates those bytes into parsed DOMs on demand and
 * lets the requisites pipeline mutate them safely.
 */

import type { Document } from "@xmldom/xmldom";
import type { DocxArchive } from "../docx/types.js";
import { parseXmlSafely, serializeXml } from "../docx/xml-utils.js";

/** Archive paths the requisites pipeline cares about. */
export const PART_PATHS = Object.freeze({
  styles: "word/styles.xml",
  numbering: "word/numbering.xml",
  rels: "word/_rels/document.xml.rels",
});

/**
 * Parsed view of a docx archive's auxiliary parts. `null` for parts
 * that don't exist in the archive (e.g. a document with no list
 * numbering has no `numbering.xml`).
 */
export interface AuxiliaryParts {
  styles: Document | null;
  numbering: Document | null;
  rels: Document | null;
}

/**
 * Pull the auxiliary parts out of `rawParts` and parse them. Missing
 * parts return `null` — they are optional in OOXML.
 */
export function parseAuxiliaryParts(archive: DocxArchive): AuxiliaryParts {
  return {
    styles: tryParse(archive, PART_PATHS.styles),
    numbering: tryParse(archive, PART_PATHS.numbering),
    rels: tryParse(archive, PART_PATHS.rels),
  };
}

function tryParse(archive: DocxArchive, path: string): Document | null {
  const bytes = archive.rawParts.get(path);
  if (!bytes) return null;
  const xml = new TextDecoder("utf-8").decode(bytes);
  return parseXmlSafely(xml, path);
}

/**
 * Write modified auxiliary parts back into `rawParts`. Used by the
 * injector after merging snippet contributions into the master.
 */
export function writeAuxiliaryParts(
  archive: DocxArchive,
  parts: Readonly<Partial<AuxiliaryParts>>,
): DocxArchive {
  // We never mutate input archives — clone the rawParts map first.
  const newParts = new Map(archive.rawParts);
  if (parts.styles !== undefined) {
    if (parts.styles === null) {
      newParts.delete(PART_PATHS.styles);
    } else {
      newParts.set(PART_PATHS.styles, encode(serializeXml(parts.styles)));
    }
  }
  if (parts.numbering !== undefined) {
    if (parts.numbering === null) {
      newParts.delete(PART_PATHS.numbering);
    } else {
      newParts.set(PART_PATHS.numbering, encode(serializeXml(parts.numbering)));
    }
  }
  if (parts.rels !== undefined) {
    if (parts.rels === null) {
      newParts.delete(PART_PATHS.rels);
    } else {
      newParts.set(PART_PATHS.rels, encode(serializeXml(parts.rels)));
    }
  }
  return { document: archive.document, rawParts: newParts };
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
