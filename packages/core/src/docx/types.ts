/**
 * Internal types for the docx subsystem.
 *
 * The engine never exposes raw `Document` nodes across package boundaries
 * — they leak xmldom's interpretation of the DOM. Inside the docx
 * subsystem we use them freely; higher layers see `DocxArchive` as an
 * opaque token that can be parsed, mutated through narrow APIs, and
 * serialised back to bytes.
 */

import type { Document } from "@xmldom/xmldom";

/**
 * Parsed representation of a .docx archive.
 *
 * `document` is the always-parsed `word/document.xml` since it is the
 * only part this engine mutates in Waves 2-5. Everything else is held
 * as raw bytes/strings (`rawParts`) and passes through unchanged when
 * the archive is serialised, preserving styles, numbering, fonts,
 * images, relationships, settings, and content-types untouched.
 *
 * Wave 6 (requisites) extends this shape: it will lift `styles`,
 * `numbering`, and `rels` into parsed form so the snippet-injection
 * remapper can splice into them.
 */
export interface DocxArchive {
  /** Parsed `word/document.xml`. */
  document: Document;
  /**
   * All other zip entries from the original archive, keyed by their
   * archive path (e.g. `word/styles.xml`, `word/media/image1.png`,
   * `_rels/.rels`).
   */
  rawParts: Map<string, Uint8Array>;
}

/** Metadata returned by AnchorMapper.ensureParaIds. */
export interface EnsureParaIdsResult {
  /** Number of paragraphs that had a new `w14:paraId` generated for them. */
  generated: number;
  /** Number of paragraphs that already had a `w14:paraId`. */
  preserved: number;
}
