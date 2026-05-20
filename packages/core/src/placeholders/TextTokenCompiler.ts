/**
 * Plain-text token compiler — converts `{{key}}` occurrences in run
 * text into proper bare-key `<w:sdt>` elements.
 *
 * Motivation: snippet authors don't want to use Word's Developer tab
 * and Content Controls. Letting them type `{{full_name}}` as plain
 * text and having the engine convert it at upload time is the simplest
 * authoring path. After compilation the document contains real SDTs
 * so the rest of the engine (TagRewriter, RequisitesEngine, render)
 * works unchanged.
 *
 * The compiler walks every `<w:p>` in document order, scans the
 * concatenated text of DIRECT-CHILD `<w:r>` elements for the
 * configured delimiters, validates each captured key against
 * `validateKey`, and wraps the matching range in a bare-key SDT via
 * `wrapBareKey`'s internal machinery (so rPr is preserved, splits
 * happen in the same way, overlap detection runs).
 *
 * Idempotency: tokens that are ALREADY inside SDTs (their text lives
 * under `<w:sdtContent>`, not as a direct-child run of `<w:p>`) are
 * invisible to the scan — running `compileTextTokens` a second time
 * is a no-op.
 *
 * @since 0.2.0-beta.1
 */

import type { Element } from "@xmldom/xmldom";
import { listParagraphs } from "../docx/AnchorMapper.js";
import type { DocxArchive } from "../docx/types.js";
import { W14_NS, W_NS } from "../docx/xml-utils.js";
import { InvalidPlaceholderTagError } from "../errors.js";
import { wrapBareKey } from "./PlaceholderEngine.js";
import { BARE_KEY_PATTERN } from "./TagValidator.js";
import { directChildren, runText } from "./run-utils.js";

/** Options for `compileTextTokens`. All fields optional. */
export interface CompileTextTokensOptions {
  /**
   * Token delimiters. Default `{ open: "{{", close: "}}" }`. Set to
   * different markers if the host's authoring convention diverges.
   * Special regex characters in either string are escaped automatically.
   */
  delimiters?: { open: string; close: string };
  /**
   * Predicate that decides whether a captured key is allowed. Default:
   * `BARE_KEY_PATTERN.test(key)`. Hosts can plug in a stricter allow-
   * list (e.g. only keys present in their data-model schema).
   */
  validateKey?: (key: string) => boolean;
  /**
   * Behaviour when `validateKey` rejects a captured key:
   * - `"ignore"` (default): leave the `{{...}}` text as plain prose.
   *   The token will not be wrapped; the snippet renders it as
   *   visible text.
   * - `"warn"`: same as `"ignore"`, but the rejected key is appended
   *   to `skipped` with `reason: "invalid-key"`.
   * - `"error"`: throw `InvalidPlaceholderTagError` immediately,
   *   aborting the compile. Use this in strict ingestion pipelines.
   */
  onUnknownKey?: "ignore" | "warn" | "error";
}

/** Per-paragraph record of a successfully compiled token. */
export interface CompiledToken {
  /** Bare key extracted from the token. */
  key: string;
  /** `w14:paraId` of the paragraph it lived in. */
  paraId: string;
  /** Zero-based index of the paragraph in document order. */
  paragraphIndex: number;
}

/** Record of a token that was found but not wrapped. */
export interface SkippedToken {
  /** The raw token text including delimiters, e.g. `"{{ Bad-Key }}"`. */
  raw: string;
  /** Machine-readable reason (`"invalid-key"`, `"complex-run"`, etc.). */
  reason: string;
}

/** Return value of `compileTextTokens`. */
export interface CompileTextTokensResult {
  /**
   * Fresh archive with the tokens replaced by SDTs. The input archive
   * is NOT mutated.
   */
  archive: DocxArchive;
  /** Tokens that were successfully wrapped. */
  compiled: CompiledToken[];
  /** Tokens that were detected but left as plain text (see `reason`). */
  skipped: SkippedToken[];
}

/** Escape regex metacharacters in a literal delimiter string. */
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Locate the run + offset within `runs` that contains `globalOffset`. */
function locateOffset(
  runTexts: string[],
  globalOffset: number,
): { runIndex: number; offset: number } | null {
  let pos = 0;
  for (let i = 0; i < runTexts.length; i++) {
    const runLength = runTexts[i] as string;
    const len = runLength.length;
    if (globalOffset < pos + len) {
      return { runIndex: i, offset: globalOffset - pos };
    }
    // Boundary case: globalOffset === pos + len AND this is the last run.
    if (globalOffset === pos + len && i === runTexts.length - 1) {
      return { runIndex: i, offset: len };
    }
    pos += len;
  }
  return null;
}

/**
 * Scan every paragraph in `archive` for `{{key}}` plain-text tokens
 * and wrap each match in a bare-key SDT.
 *
 * @see compileTextTokens — full contract.
 *
 * @throws InvalidPlaceholderTagError — only when `onUnknownKey === "error"`
 *   and a captured key fails `validateKey`. Other errors during wrap
 *   (e.g. complex-run mid-text) are caught and recorded as `skipped`.
 */
export function compileTextTokens(
  archive: DocxArchive,
  options: CompileTextTokensOptions = {},
): CompileTextTokensResult {
  const open = options.delimiters?.open ?? "{{";
  const close = options.delimiters?.close ?? "}}";
  const validateKey = options.validateKey ?? ((k: string) => BARE_KEY_PATTERN.test(k));
  const onUnknownKey = options.onUnknownKey ?? "ignore";

  // A fresh, non-global regex so we can call `exec`/`match` repeatedly
  // without lastIndex bookkeeping.
  const tokenPattern = new RegExp(
    `${escapeForRegex(open)}\\s*([a-z][a-z0-9_]*)\\s*${escapeForRegex(close)}`,
  );

  const compiled: CompiledToken[] = [];
  const skipped: SkippedToken[] = [];

  // Outer iteration: each successful wrap returns a fresh archive
  // (immutability), so we re-list paragraphs each pass until no more
  // tokens are found anywhere. This is O(P × T) where P is paragraph
  // count and T is tokens per paragraph — both small in real snippets.
  let current = archive;
  let didSomething = true;
  while (didSomething) {
    didSomething = false;
    const paragraphs = listParagraphs(current);

    for (let pIndex = 0; pIndex < paragraphs.length; pIndex++) {
      const entry = paragraphs[pIndex];
      if (!entry) continue;
      const { paraId, element: para } = entry;

      // Collect DIRECT-child runs of the paragraph. Children that are
      // SDTs (or anything else) are intentionally skipped — this is
      // how idempotency is achieved: once a token sits inside an SDT,
      // its text no longer appears in any direct-child run.
      const runs: Element[] = [];
      for (const child of directChildren(para)) {
        if (child.namespaceURI === W_NS && child.localName === "r") {
          runs.push(child);
        }
      }
      if (runs.length === 0) continue;

      const runTexts = runs.map((r) => runText(r));
      const fullText = runTexts.join("");
      const match = fullText.match(tokenPattern);
      if (!match || match.index === undefined) continue;

      const key = match[1];
      if (key === undefined) continue;
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      const raw = match[0];

      // Honour `validateKey` + `onUnknownKey`.
      if (!validateKey(key)) {
        if (onUnknownKey === "error") {
          throw new InvalidPlaceholderTagError(
            key,
            `compileTextTokens: validateKey rejected '${key}' (raw token '${raw}')`,
          );
        }
        if (onUnknownKey === "warn") {
          skipped.push({ raw, reason: "invalid-key" });
        }
        // For both "ignore" and "warn" we leave the token as plain
        // prose. To avoid re-matching the same token forever, we
        // advance to the next paragraph without setting didSomething.
        continue;
      }

      // Compute WrapLocation from the global character offsets.
      const startLoc = locateOffset(runTexts, matchStart);
      const endLoc = locateOffset(runTexts, matchEnd);
      if (!startLoc || !endLoc) {
        skipped.push({ raw, reason: "offset-resolution-failed" });
        continue;
      }

      // Use the snippet paraId for diagnostics if it lacks a w14:paraId.
      const wrapParaId = paraId.length > 0 ? paraId : "(no-paraId)";

      try {
        current = wrapBareKey(
          current,
          {
            paraId: wrapParaId,
            startRunIndex: startLoc.runIndex,
            startOffset: startLoc.offset,
            endRunIndex: endLoc.runIndex,
            endOffset: endLoc.offset,
          },
          { key, alias: key, dataType: "text" },
        );
        compiled.push({ key, paraId: wrapParaId, paragraphIndex: pIndex });
        didSomething = true;
        // Restart the outer while loop — the new archive has freshly
        // cloned paragraph elements, so any cached references are stale.
        break;
      } catch (err) {
        // `wrapBareKey` will throw for: complex-run mid-text splits,
        // overlap with existing SDT (which only happens if a token's
        // braces literally span an existing wrap), or invalid run
        // indices. Record the skip and move on.
        const reason =
          err instanceof Error ? err.message.replace(/\s+/g, " ").slice(0, 200) : String(err);
        skipped.push({ raw, reason });
      }
    }
  }

  return { archive: current, compiled, skipped };
}

// `W14_NS` is imported but not used in the current implementation;
// kept available for future per-paragraph diagnostics. Silence
// `noUnusedLocals` by referencing it once.
void W14_NS;
