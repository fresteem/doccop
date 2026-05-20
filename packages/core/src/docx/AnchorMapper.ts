/**
 * Anchor mapping for stable paragraph identity inside .docx files.
 *
 * Word's `w14:paraId` is a 4-byte hex identifier that Microsoft Word
 * itself stamps onto each paragraph since Office 2010. Crucially,
 * `paraId` is **invariant under document edits**: moving a paragraph,
 * inserting another one before it, splitting it, or duplicating it does
 * not change the surviving paragraph's id. That property is what lets us
 * keep SDT-based placeholders pinned to specific positions across
 * subsequent template versions.
 *
 * This module guarantees that every `<w:p>` in a `DocxArchive` has a
 * `w14:paraId`. Word-authored files normally already do; templates
 * produced by libraries (or stripped by mail-merge tools) often do not,
 * and the engine generates one in that case.
 *
 * `paraId` format per ECMA-376 §17.13.4.30: hexBinary, 4 bytes, exactly
 * 8 hex digits, conventionally uppercase. We follow Word's convention.
 */

import { randomBytes } from "node:crypto";
import type { Element } from "@xmldom/xmldom";
import type { DocxArchive, EnsureParaIdsResult } from "./types.js";
import { W14_NS, W_NS, ensureNamespaceOnRoot, findElements } from "./xml-utils.js";

/** Pattern that a valid `paraId` must satisfy after generation. */
const PARA_ID_PATTERN = /^[0-9A-F]{8}$/;

/**
 * Ensure every `<w:p>` in the archive has a `w14:paraId` attribute.
 * Existing ids are preserved verbatim. Missing ids are filled with
 * cryptographically random 8-hex-digit values, uppercase.
 *
 * The mutation is **in-place** on `archive.document`; the returned counts
 * are diagnostic only.
 *
 * @returns Number of paragraphs whose id was generated vs preserved.
 */
export function ensureParaIds(archive: DocxArchive): EnsureParaIdsResult {
  const paragraphs = findElements(archive.document, W_NS, "p");
  // The `w14` namespace declaration may not exist on the root if the
  // document was authored by a non-Word tool. Add it once up front so
  // newly inserted attributes serialise with their proper prefix.
  ensureNamespaceOnRoot(archive.document, "w14", W14_NS);

  let generated = 0;
  let preserved = 0;
  const seen = new Set<string>();

  for (const p of paragraphs) {
    const existing = p.getAttributeNS(W14_NS, "paraId");
    if (existing && PARA_ID_PATTERN.test(existing) && !seen.has(existing)) {
      // Existing id is well-formed and not a duplicate — leave it alone.
      seen.add(existing);
      preserved++;
      continue;
    }
    // Either missing, malformed (e.g. lowercase from a buggy generator),
    // or duplicated within the same file — assign a fresh one.
    const fresh = generateParaId(seen);
    seen.add(fresh);
    p.setAttributeNS(W14_NS, "w14:paraId", fresh);
    generated++;
  }

  return { generated, preserved };
}

/**
 * Locate a paragraph element by its `w14:paraId`.
 * Returns `null` if no match exists.
 */
export function findByParaId(archive: DocxArchive, paraId: string): Element | null {
  if (!PARA_ID_PATTERN.test(paraId)) return null;
  const paragraphs = findElements(archive.document, W_NS, "p");
  for (const p of paragraphs) {
    if (p.getAttributeNS(W14_NS, "paraId") === paraId) return p;
  }
  return null;
}

/**
 * Enumerate every paragraph in document order with its `paraId`.
 * Use this when you need to walk content sequentially (e.g. for HTML
 * preview rendering). The returned ids are guaranteed unique only when
 * the archive has gone through `ensureParaIds` first.
 */
export function listParagraphs(archive: DocxArchive): Array<{ paraId: string; element: Element }> {
  const paragraphs = findElements(archive.document, W_NS, "p");
  const out: Array<{ paraId: string; element: Element }> = [];
  for (const p of paragraphs) {
    const id = p.getAttributeNS(W14_NS, "paraId");
    if (id && PARA_ID_PATTERN.test(id)) {
      out.push({ paraId: id, element: p });
    }
  }
  return out;
}

/**
 * Produce a fresh 8-hex-digit uppercase paraId that doesn't collide with
 * `seen`. The set of possible values is 2^32; collisions in a single
 * document are statistically impossible, but the loop is here so the
 * function is total.
 */
function generateParaId(seen: ReadonlySet<string>): string {
  // Drawing 4 bytes at a time keeps the call site simple. If a collision
  // happens (it won't in practice with a 2^32 space and document-scale
  // populations), we retry. Bounded retry just to give a clear failure
  // in the impossible-but-not-zero edge case rather than infinite loop.
  for (let i = 0; i < 1024; i++) {
    const id = randomBytes(4).toString("hex").toUpperCase();
    if (!seen.has(id)) return id;
  }
  throw new Error("AnchorMapper: exhausted 1024 retries — RNG broken?");
}
