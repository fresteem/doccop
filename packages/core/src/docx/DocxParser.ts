/**
 * .docx ↔ DocxArchive boundary.
 *
 * `parse` unpacks the zip, pulls `word/document.xml` into a parsed DOM,
 * preserves every other part as raw bytes, and applies engine resource
 * limits. `serialize` packs the (possibly-mutated) archive back into a
 * zip suitable for download.
 *
 * The parser deliberately does not understand or mutate anything outside
 * `word/document.xml` in this Wave. That keeps Word's hand-crafted
 * styles.xml / numbering.xml / fontTable.xml / theme1.xml byte-identical
 * across round-trips, which avoids subtle formatting drift.
 */

import PizZip from "pizzip";
import { MalformedDocxError, TemplateTooLargeError } from "../errors.js";
import type { DocxArchive } from "./types.js";
import { parseXmlSafely, serializeXml } from "./xml-utils.js";

/** Path inside the zip where the main document XML lives. */
const DOCUMENT_PART = "word/document.xml";

/** Defaults if the caller does not pass `limits`. Match `EngineLimits`. */
const DEFAULT_MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

/** Options accepted by `parse`. */
export interface ParseOptions {
  /** Reject archives larger than this many bytes. Default 10 MiB. */
  maxBytes?: number;
}

/**
 * Parse a `.docx` byte array into a `DocxArchive`.
 *
 * @throws TemplateTooLargeError — if `bytes.length` exceeds the limit.
 * @throws MalformedDocxError — on zip errors or a missing document part.
 * @throws XxeDetectedError — if document.xml contains an `<!ENTITY>` decl.
 */
export function parse(bytes: Uint8Array, opts: ParseOptions = {}): DocxArchive {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_TEMPLATE_BYTES;
  if (bytes.length > maxBytes) {
    throw new TemplateTooLargeError(bytes.length, maxBytes);
  }

  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch (err) {
    throw new MalformedDocxError("not a valid zip archive", err);
  }

  const documentEntry = zip.file(DOCUMENT_PART);
  if (!documentEntry) {
    throw new MalformedDocxError(`archive is missing ${DOCUMENT_PART}`);
  }

  let documentXml: string;
  try {
    documentXml = documentEntry.asText();
  } catch (err) {
    throw new MalformedDocxError(`failed to read ${DOCUMENT_PART}`, err);
  }

  const document = parseXmlSafely(documentXml, DOCUMENT_PART);

  // Stash everything else byte-for-byte. pizzip exposes a `files` map that
  // includes directory entries (with `dir: true`) — those are skipped.
  const rawParts = new Map<string, Uint8Array>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (path === DOCUMENT_PART) continue;
    // Directories show up as entries with no content; PizZip exposes
    // `.dir` on its file objects.
    if ((entry as { dir?: boolean }).dir) continue;
    rawParts.set(path, entry.asUint8Array());
  }

  return { document, rawParts };
}

/**
 * Serialise a `DocxArchive` back to `.docx` bytes.
 *
 * The output zip is deflate-compressed with the same parts at the same
 * paths. Byte-for-byte equality with the original input is NOT guaranteed
 * — DOM serialisation may reorder attributes, normalise whitespace, etc.
 * Semantic equality (the file opens cleanly in Word and renders the same
 * content) is the contract.
 */
export function serialize(archive: DocxArchive): Uint8Array {
  const zip = new PizZip();
  zip.file(DOCUMENT_PART, serializeXml(archive.document));
  for (const [path, bytes] of archive.rawParts) {
    zip.file(path, bytes);
  }
  const out = zip.generate({
    type: "uint8array",
    compression: "DEFLATE",
    // mimeType is not strictly required but Word likes it set.
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return out;
}
