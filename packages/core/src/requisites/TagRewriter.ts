/**
 * Bare-key → scoped tag rewriting for snippet placeholders.
 *
 * Snippets are authored without knowing which party slot they'll bind
 * to at render time (a single TOV-requisites snippet might be used for
 * party_a in one contract and party_b in another). They therefore use
 * BARE placeholder keys: `{{full_name}}`, `{{edrpou}}` etc.
 *
 * When the engine injects a snippet for a specific party slot, it
 * rewrites those bare tags to fully-qualified `party_<slot>.<key>` so
 * the standard `DocxRenderer` pipeline can resolve them. This mutation
 * happens on a snippet-archive clone, not the original.
 *
 * What "bare key" means here: the SDT's `<w:tag w:val="...">` value
 * matches `^[a-z][a-z0-9_]*$` — lowercase alphanumeric + underscores,
 * no dot, no colon. Tags that already contain `.` or `:` are left
 * alone; this lets snippets opt into `system.today` / `system.now`
 * without rewriting.
 */

import type { DocxArchive } from "../docx/types.js";
import { W_NS, findElements } from "../docx/xml-utils.js";
import { SnippetCannotContainRequisitesError } from "../errors.js";

const BARE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Walk every `<w:sdt>` in the snippet body and:
 *   1. Reject any `requisites:*` tag — snippets may not nest requisites
 *      blocks (recursive injection is out of scope, both for safety
 *      and because the data model doesn't carry a binding for them).
 *   2. Rewrite bare-key tags to `${targetParty}.${key}`.
 *   3. Leave already-qualified tags (`system.today`, `custom.X`,
 *      previously-rewritten ones) untouched.
 *
 * Mutates `snippet.document` in place — call on a clone, not the
 * original archive.
 *
 * @returns the count of tags rewritten (diagnostic only).
 */
export function rewriteSnippetTags(snippet: DocxArchive, targetParty: string): number {
  let rewrites = 0;
  const sdts = findElements(snippet.document, W_NS, "sdt");
  for (const sdt of sdts) {
    // Look up the <w:tag> child of <w:sdtPr>.
    const sdtPrs = findElements(sdt, W_NS, "sdtPr");
    const sdtPr = sdtPrs.find((p) => p.parentNode === sdt);
    if (!sdtPr) continue;
    const tagEls = findElements(sdtPr, W_NS, "tag");
    const tagEl = tagEls.find((t) => t.parentNode === sdtPr);
    if (!tagEl) continue;
    const current = tagEl.getAttributeNS(W_NS, "val");
    if (!current) continue;

    // Safety: forbid requisites recursion.
    if (current.startsWith("requisites:")) {
      throw new SnippetCannotContainRequisitesError(current);
    }

    // Skip already-qualified tags.
    if (current.includes(".")) continue;

    // Bare key → rewrite. Anything that doesn't match the bare-key
    // pattern is left alone (a typo will surface later via
    // InvalidPlaceholderTagError during render).
    if (BARE_KEY_PATTERN.test(current)) {
      tagEl.setAttributeNS(W_NS, "w:val", `${targetParty}.${current}`);
      rewrites++;
    }
  }
  return rewrites;
}
