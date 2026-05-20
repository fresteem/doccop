/**
 * Placeholder editing engine — wrap, unwrap, list, replace.
 *
 * This is the operational core of the template editor. A user selects
 * text in the preview, picks a variable, and we materialise that
 * selection as an `<w:sdt>` in document.xml. Later they can unwrap
 * (remove the binding, keep the text) or replace (substitute resolved
 * value at render time — Wave 5 uses this).
 *
 * All mutations clone the input `DocxArchive`'s document so the caller
 * always sees an immutable boundary. The original archive is never
 * touched.
 */

import type { Element, Node } from "@xmldom/xmldom";
import { listParagraphs } from "../docx/AnchorMapper.js";
import type { DocxArchive } from "../docx/types.js";
import { W14_NS, W_NS, findElements, parseXmlSafely, serializeXml } from "../docx/xml-utils.js";
import {
  InvalidPlaceholderTagError,
  OverlappingPlaceholderError,
  PlaceholderNotFoundError,
} from "../errors.js";
import type { DataType, Placeholder } from "../types.js";
import { buildSdt, getSdtContent } from "./SdtBuilder.js";
import { decomposeTag, validateAlias } from "./TagValidator.js";
import {
  directChild,
  directChildren,
  insertAfter,
  isSimpleRun,
  listDirectRuns,
  listDirectSdts,
  runText,
  splitSimpleRun,
} from "./run-utils.js";
import type { BlockWrapLocation, PlaceholderSpec, WrapLocation } from "./types.js";

// ─── list ──────────────────────────────────────────────────────────────────

/**
 * Enumerate every placeholder in the archive in document order.
 *
 * Placeholders are surfaced via their `<w:sdt>` wrapper: `tag` (engine
 * binding), `alias` (display label) and the paragraph anchor they sit
 * in. For block-level SDTs spanning multiple paragraphs, the `paraId`
 * reports the FIRST contained paragraph.
 *
 * @param archive Source archive. Not mutated.
 * @param dataTypes Optional map of tag → DataType to fill in the engine
 *   catalogue. Tags not in the map default to "text".
 */
export function list(
  archive: DocxArchive,
  dataTypes: ReadonlyMap<string, DataType> = new Map(),
): Placeholder[] {
  const out: Placeholder[] = [];
  // Find every <w:sdt> in document order. xmldom's
  // getElementsByTagNameNS is recursive — that's exactly what we want.
  const sdts = findElements(archive.document, W_NS, "sdt");
  for (const sdt of sdts) {
    const sdtPr = directChild(sdt, W_NS, "sdtPr");
    if (!sdtPr) continue;
    const tagEl = directChild(sdtPr, W_NS, "tag");
    const tag = tagEl?.getAttributeNS(W_NS, "val");
    if (!tag) continue;
    const aliasEl = directChild(sdtPr, W_NS, "alias");
    const alias = aliasEl?.getAttributeNS(W_NS, "val") ?? tag;

    let decomposed: ReturnType<typeof decomposeTag>;
    try {
      decomposed = decomposeTag(tag);
    } catch {
      // Tag in the document doesn't match our format — skip it. The
      // engine's catalogue only tracks well-formed tags.
      continue;
    }

    const paraId = findEnclosingParaId(sdt);
    if (!paraId) continue;

    if (decomposed.kind === "value") {
      out.push({
        tag,
        alias,
        scope: decomposed.scope,
        key: decomposed.key,
        dataType: dataTypes.get(tag) ?? "text",
        paraId,
      });
    } else {
      // requisites:* — treat as a synthetic placeholder with scope=custom
      // for catalogue purposes; the runtime engine routes it differently.
      out.push({
        tag,
        alias,
        scope: "custom",
        key: decomposed.partyRole,
        dataType: dataTypes.get(tag) ?? "text",
        paraId,
      });
    }
  }
  return out;
}

/**
 * Walk up from the SDT to the nearest `<w:p>` and return its
 * `w14:paraId`. For block-level SDTs that sit between paragraphs, look
 * inside the SDT content and return the first contained paragraph's id.
 */
function findEnclosingParaId(sdt: Element): string | null {
  // Look up first.
  let cur: Node | null = sdt.parentNode;
  while (cur && cur.nodeType === 1) {
    const el = cur as Element;
    if (el.namespaceURI === W_NS && el.localName === "p") {
      const id = el.getAttributeNS(W14_NS, "paraId");
      return id || null;
    }
    cur = cur.parentNode;
  }
  // Block SDT: look at first contained paragraph.
  const content = directChild(sdt, W_NS, "sdtContent");
  if (content) {
    const innerParas = findElements(content, W_NS, "p");
    const first = innerParas[0];
    if (first) {
      const id = first.getAttributeNS(W14_NS, "paraId");
      return id || null;
    }
  }
  return null;
}

// ─── wrap ──────────────────────────────────────────────────────────────────

/**
 * Wrap a selection in a new `<w:sdt>` placeholder. Returns a fresh
 * `DocxArchive` with the mutation applied; the input archive is
 * unchanged.
 *
 * @throws {InvalidPlaceholderTagError} on bad tag/alias.
 * @throws {PlaceholderNotFoundError} if `loc.paraId` is unknown.
 * @throws {OverlappingPlaceholderError} if the selection range crosses
 *   an existing SDT (or its boundary falls inside one).
 * @throws Error for selections that would require splitting a complex
 *   run (tabs/breaks/multiple texts) — the UI should disable wrap on
 *   such ranges.
 */
export function wrap(archive: DocxArchive, loc: WrapLocation, spec: PlaceholderSpec): DocxArchive {
  // Validate inputs upfront — we don't want partial mutation if the
  // tag turns out to be invalid.
  decomposeTag(spec.tag);
  validateAlias(spec.tag, spec.alias);
  validateRange(loc);

  const cloned = cloneArchive(archive);
  const paragraph = findParagraphByParaId(cloned, loc.paraId);
  if (!paragraph) {
    throw new PlaceholderNotFoundError(loc.paraId);
  }

  // Overlap check: if there's an SDT between the runs the user
  // selected, refuse. We do this before any mutation.
  guardAgainstOverlap(paragraph, loc);

  // Locate the runs by their direct-child index. Splits happen against
  // the paragraph's direct `<w:r>` children only.
  const runs = listDirectRuns(paragraph);
  const startRun = runs[loc.startRunIndex];
  const endRun = runs[loc.endRunIndex];
  if (!startRun || !endRun) {
    throw new PlaceholderNotFoundError(
      `${loc.paraId}/runs[${loc.startRunIndex}..${loc.endRunIndex}]`,
    );
  }

  // Validate runs in range are simple enough to split. We allow whole-
  // run inclusion of complex runs (no split needed), only erroring if a
  // mid-run split would be required on a complex run.
  if (loc.startOffset > 0 && !isSimpleRun(startRun)) {
    throw new Error(
      "Cannot split a run that contains tabs, breaks, or multiple text segments — adjust the selection.",
    );
  }
  if (loc.endRunIndex === loc.startRunIndex) {
    const text = runText(startRun);
    if (loc.endOffset < text.length && !isSimpleRun(startRun)) {
      throw new Error("Cannot split a complex run mid-text — adjust the selection.");
    }
  } else if (loc.endOffset < runText(endRun).length && !isSimpleRun(endRun)) {
    throw new Error("Cannot split a complex run mid-text — adjust the selection.");
  }

  // Perform the splits and collect the runs that will end up inside
  // the SDT's content.
  const toWrap = performSplits(paragraph, runs, loc, startRun, endRun);

  // Build the SDT and move the collected runs into its content.
  const sdt = buildSdt(cloned.document, { tag: spec.tag, alias: spec.alias });
  const sdtContent = getSdtContent(sdt);

  // Insert SDT before the first run we're about to wrap.
  const firstToWrap = toWrap[0];
  if (!firstToWrap) {
    throw new Error("wrap: selection collapsed to empty after splits");
  }
  paragraph.insertBefore(sdt, firstToWrap);

  // Move runs into sdtContent (in order).
  for (const r of toWrap) {
    paragraph.removeChild(r);
    sdtContent.appendChild(r);
  }

  return cloned;
}

/** Reject empty / inverted ranges upfront. */
function validateRange(loc: WrapLocation): void {
  if (loc.startRunIndex < 0 || loc.endRunIndex < 0) {
    throw new Error("WrapLocation: negative run index");
  }
  if (loc.startRunIndex > loc.endRunIndex) {
    throw new Error("WrapLocation: startRunIndex must be <= endRunIndex");
  }
  if (loc.startOffset < 0 || loc.endOffset < 0) {
    throw new Error("WrapLocation: negative offset");
  }
  if (loc.startRunIndex === loc.endRunIndex && loc.startOffset === loc.endOffset) {
    throw new Error("WrapLocation: empty selection (start === end)");
  }
  if (loc.startRunIndex === loc.endRunIndex && loc.startOffset > loc.endOffset) {
    throw new Error("WrapLocation: startOffset > endOffset in same run");
  }
}

/**
 * Refuse to wrap if any direct-child `<w:sdt>` sits between the start
 * and end runs. The user must first remove that SDT.
 */
function guardAgainstOverlap(paragraph: Element, loc: WrapLocation): void {
  // Walk paragraph direct children in document order. Track how many
  // <w:r> we have passed. If we hit a <w:sdt> while inside the range,
  // it overlaps.
  let runCounter = 0;
  let inRange = false;
  for (const child of directChildren(paragraph)) {
    if (child.namespaceURI !== W_NS) continue;
    if (child.localName === "r") {
      if (runCounter === loc.startRunIndex) inRange = true;
      if (runCounter === loc.endRunIndex) {
        // After processing the end run, leave the range.
        // We need to check siblings before this run too, but those have
        // already been visited. So set after counter increment.
      }
      if (runCounter > loc.endRunIndex) inRange = false;
      runCounter++;
      continue;
    }
    if (child.localName === "sdt") {
      if (inRange) {
        const tag = directChild(child, W_NS, "sdtPr")
          ? directChild(directChild(child, W_NS, "sdtPr") as Element, W_NS, "tag")?.getAttributeNS(
              W_NS,
              "val",
            )
          : null;
        throw new OverlappingPlaceholderError(tag ?? "unknown");
      }
    }
  }
}

/**
 * Apply the start/end splits to `startRun` and `endRun` and return the
 * runs (in document order) that need to be moved into the SDT.
 */
function performSplits(
  paragraph: Element,
  runs: readonly Element[],
  loc: WrapLocation,
  startRun: Element,
  endRun: Element,
): Element[] {
  // Same-run case is special: a single run becomes up to three pieces.
  if (loc.startRunIndex === loc.endRunIndex) {
    const text = runText(startRun);
    // If selection covers the whole run, no split.
    if (loc.startOffset === 0 && loc.endOffset === text.length) {
      return [startRun];
    }
    if (loc.startOffset === 0) {
      // Split once at endOffset; left half is wrapped, right half stays.
      const [left, right] = splitSimpleRun(startRun, loc.endOffset);
      paragraph.replaceChild(left, startRun);
      insertAfter(left, right);
      return [left];
    }
    if (loc.endOffset === text.length) {
      // Split once at startOffset; right half is wrapped, left half stays.
      const [left, right] = splitSimpleRun(startRun, loc.startOffset);
      paragraph.replaceChild(left, startRun);
      insertAfter(left, right);
      return [right];
    }
    // Mid-mid split: produce left, middle, right.
    const [leftA, restA] = splitSimpleRun(startRun, loc.startOffset);
    const [mid, rightA] = splitSimpleRun(restA, loc.endOffset - loc.startOffset);
    paragraph.replaceChild(leftA, startRun);
    insertAfter(leftA, mid);
    insertAfter(mid, rightA);
    return [mid];
  }

  // Cross-run case. Walk from start to end collecting runs to move.
  // Splits happen on start (if startOffset > 0) and end (if endOffset
  // < end text length); intermediate runs are wrapped whole.
  let collected: Element[];

  // Handle start run.
  let activeStart: Element;
  if (loc.startOffset === 0) {
    activeStart = startRun;
  } else {
    const [left, right] = splitSimpleRun(startRun, loc.startOffset);
    paragraph.replaceChild(left, startRun);
    insertAfter(left, right);
    activeStart = right;
  }

  // Handle end run.
  let activeEnd: Element;
  const endText = runText(endRun);
  if (loc.endOffset >= endText.length) {
    activeEnd = endRun;
  } else {
    const [left, right] = splitSimpleRun(endRun, loc.endOffset);
    paragraph.replaceChild(left, endRun);
    insertAfter(left, right);
    activeEnd = left;
  }

  // Re-list runs since splits changed their indices. Collect the
  // window [activeStart..activeEnd] inclusive.
  collected = [];
  const allRuns = listDirectRuns(paragraph);
  let inside = false;
  for (const r of allRuns) {
    if (r === activeStart) inside = true;
    if (inside) collected.push(r);
    if (r === activeEnd) break;
  }
  // Silence unused-var lint — `runs` parameter is part of the signature
  // for clarity even though we re-list after splits.
  void runs;
  return collected;
}

// ─── wrapBlock ─────────────────────────────────────────────────────────────

/**
 * Wrap an inclusive range of top-level paragraphs in a block-level
 * `<w:sdt>`. Used to mark whole-paragraph regions as
 * `requisites:party_X` injection points — the `RequisitesEngine` (Wave 6)
 * locates these block SDTs at render time and replaces them with the
 * per-subtype snippet body.
 *
 * Unlike `wrap`, which produces an INLINE SDT inside one paragraph,
 * `wrapBlock` produces a SIBLING SDT in `<w:body>` next to the paragraphs
 * it captures.
 *
 * @param archive  Source archive. Not mutated.
 * @param opts     Inclusive paragraph-id range. `startParaId === endParaId`
 *                 is allowed (single-paragraph block). Both paraIds must
 *                 resolve to paragraphs that are direct children of `<w:body>`.
 * @param spec     Placeholder spec. `spec.tag` MUST match `requisites:party_<id>`;
 *                 inline value placeholders go through `wrap`.
 *
 * @throws {InvalidPlaceholderTagError} when `spec.tag` is not a `requisites:*`
 *   tag, or `spec.alias` is malformed.
 * @throws {PlaceholderNotFoundError}   when either paraId is unknown.
 * @throws {OverlappingPlaceholderError} when the range crosses an existing
 *   sibling SDT — caller must unwrap first.
 * @throws Error for ranges whose bounds don't share a `<w:body>` parent,
 *   or where `endParaId` does not come after `startParaId` in document
 *   order. These represent client-side bugs (selection across structural
 *   boundaries) and are not modelled as `DocCopError`s in v1.
 */
export function wrapBlock(
  archive: DocxArchive,
  opts: BlockWrapLocation,
  spec: PlaceholderSpec,
): DocxArchive {
  // 1. Validate the tag is a requisites placeholder, not a value one.
  const decomposed = decomposeTag(spec.tag);
  if (decomposed.kind !== "requisites") {
    throw new InvalidPlaceholderTagError(
      spec.tag,
      "wrapBlock requires a requisites:party_<id> tag; use wrap() for value placeholders",
    );
  }
  validateAlias(spec.tag, spec.alias);

  // 2. Locate the bounding paragraphs in a fresh clone.
  const cloned = cloneArchive(archive);
  const startPara = findParagraphByParaId(cloned, opts.startParaId);
  if (!startPara) throw new PlaceholderNotFoundError(opts.startParaId);
  const endPara = findParagraphByParaId(cloned, opts.endParaId);
  if (!endPara) throw new PlaceholderNotFoundError(opts.endParaId);

  // 3. Both must share the <w:body> parent. Paragraphs inside table cells
  //    or inside an existing block SDT are rejected — the UI should not
  //    allow such a selection.
  const parent = startPara.parentNode;
  if (!parent || parent !== endPara.parentNode) {
    throw new Error(
      `wrapBlock: startParaId (${opts.startParaId}) and endParaId (${opts.endParaId}) must share the same parent`,
    );
  }
  if (
    parent.nodeType !== 1 ||
    (parent as Element).namespaceURI !== W_NS ||
    (parent as Element).localName !== "body"
  ) {
    throw new Error(
      "wrapBlock: range must consist of top-level paragraphs directly under <w:body>",
    );
  }
  const body = parent as Element;

  // 4. Walk start → end via nextSibling, collecting elements. Refuse to
  //    cross an existing SDT — that's an overlap and the caller must
  //    unwrap first. Non-element nodes (text, comments) are skipped.
  const range: Element[] = [];
  let cur: Node | null = startPara;
  let reachedEnd = false;
  while (cur) {
    if (cur.nodeType === 1) {
      const el = cur as Element;
      if (el.namespaceURI === W_NS && el.localName === "sdt") {
        const existingPr = directChild(el, W_NS, "sdtPr");
        const existingTag = existingPr
          ? (directChild(existingPr, W_NS, "tag")?.getAttributeNS(W_NS, "val") ?? "unknown")
          : "unknown";
        throw new OverlappingPlaceholderError(existingTag);
      }
      range.push(el);
    }
    if (cur === endPara) {
      reachedEnd = true;
      break;
    }
    cur = cur.nextSibling;
  }
  if (!reachedEnd) {
    throw new Error(
      `wrapBlock: endParaId (${opts.endParaId}) does not come after startParaId (${opts.startParaId}) in document order`,
    );
  }
  const firstInRange = range[0];
  if (!firstInRange) {
    // Unreachable: startPara is always pushed first.
    throw new Error("wrapBlock: empty range after collection");
  }

  // 5. Build the SDT, splice it in, and move the ranged elements into it.
  const sdt = buildSdt(cloned.document, { tag: spec.tag, alias: spec.alias });
  const sdtContent = getSdtContent(sdt);
  body.insertBefore(sdt, firstInRange);
  for (const el of range) {
    body.removeChild(el);
    sdtContent.appendChild(el);
  }

  return cloned;
}

// ─── unwrap ────────────────────────────────────────────────────────────────

/**
 * Remove the SDT with the matching tag and put its content back into
 * the parent. Returns a fresh archive.
 *
 * @throws {PlaceholderNotFoundError} if no SDT with that tag exists.
 */
export function unwrap(archive: DocxArchive, tag: string): DocxArchive {
  const cloned = cloneArchive(archive);
  const sdts = findElements(cloned.document, W_NS, "sdt");
  for (const sdt of sdts) {
    const sdtPr = directChild(sdt, W_NS, "sdtPr");
    if (!sdtPr) continue;
    const tagEl = directChild(sdtPr, W_NS, "tag");
    const sdtTag = tagEl?.getAttributeNS(W_NS, "val");
    if (sdtTag !== tag) continue;

    const content = directChild(sdt, W_NS, "sdtContent");
    const parent = sdt.parentNode;
    if (!parent) {
      throw new Error("unwrap: SDT has no parent");
    }
    if (content) {
      // Move all element children of sdtContent before the SDT.
      // We snapshot the children first because moving them mutates
      // sdtContent's child list.
      const movables: Node[] = [];
      let n: Node | null = content.firstChild;
      while (n) {
        movables.push(n);
        n = n.nextSibling;
      }
      for (const m of movables) {
        parent.insertBefore(m, sdt);
      }
    }
    parent.removeChild(sdt);
    return cloned;
  }
  throw new PlaceholderNotFoundError(tag);
}

// ─── replace ───────────────────────────────────────────────────────────────

/**
 * Replace the content of every SDT whose tag matches `tag` with a single
 * run containing `value`. Used by DocxRenderer (Wave 5).
 *
 * Multiple matches are supported because Word allows the same content
 * control to appear in many places (a "data binding" pattern).
 *
 * Run-property preservation: the substituted run inherits `<w:rPr>` from
 * the FIRST `<w:r>` descendant of the SDT's previous content (depth-first
 * document order). This keeps bold / italic / font-size / colour / font-
 * family applied to placeholder text — critical for legal documents
 * where signatory names and IBANs are typically bold. When the previous
 * content contains multiple runs with different formatting (rare; happens
 * after wrapping a selection that crossed a formatting boundary), only
 * the first run's `<w:rPr>` is applied — known limitation, simplest rule.
 * When the previous content has no run at all the new run carries no
 * `<w:rPr>` and renders in the paragraph's default formatting.
 *
 * @throws {PlaceholderNotFoundError} if no SDT with that tag exists.
 */
export function replace(archive: DocxArchive, tag: string, value: string): DocxArchive {
  const cloned = cloneArchive(archive);
  const sdts = findElements(cloned.document, W_NS, "sdt");
  let touched = 0;
  for (const sdt of sdts) {
    const sdtPr = directChild(sdt, W_NS, "sdtPr");
    if (!sdtPr) continue;
    const tagEl = directChild(sdtPr, W_NS, "tag");
    const sdtTag = tagEl?.getAttributeNS(W_NS, "val");
    if (sdtTag !== tag) continue;

    const content = directChild(sdt, W_NS, "sdtContent");
    if (!content) continue;

    // Capture <w:rPr> from the first descendant run BEFORE wiping the
    // content. Deep-clone so subsequent mutations on `cloned.document`
    // can't reach back into the captured node.
    const firstRun = findElements(content, W_NS, "r")[0];
    const firstRpr = firstRun ? directChild(firstRun, W_NS, "rPr") : null;
    const preservedRpr = firstRpr ? (firstRpr.cloneNode(true) as Element) : null;

    // Wipe children.
    let n: Node | null = content.firstChild;
    while (n) {
      const next = n.nextSibling;
      content.removeChild(n);
      n = next;
    }
    // Insert a fresh `<w:r>[<w:rPr>...</w:rPr>]<w:t xml:space="preserve">value</w:t></w:r>`.
    // OOXML requires <w:rPr> to precede content children inside <w:r>.
    const newRun = cloned.document.createElementNS(W_NS, "w:r");
    if (preservedRpr) {
      newRun.appendChild(preservedRpr);
    }
    const t = cloned.document.createElementNS(W_NS, "w:t");
    t.setAttribute("xml:space", "preserve");
    t.appendChild(cloned.document.createTextNode(value));
    newRun.appendChild(t);
    content.appendChild(newRun);
    touched++;
  }
  if (touched === 0) {
    throw new PlaceholderNotFoundError(tag);
  }
  return cloned;
}

// ─── archive cloning ───────────────────────────────────────────────────────

/**
 * Produce a deep clone of the archive so callers don't share mutable
 * state. We round-trip document.xml through serialize+parse — slightly
 * slower than `cloneNode(true)` on a hand-built Document, but gives us
 * an honest fresh DOM with all namespace declarations intact (xmldom's
 * Document construction API has surprises that break our type contract).
 *
 * rawParts are shared by reference (the engine never mutates them).
 */
function cloneArchive(archive: DocxArchive): DocxArchive {
  const xml = serializeXml(archive.document);
  const fresh = parseXmlSafely(xml, "word/document.xml");
  return {
    document: fresh,
    rawParts: archive.rawParts,
  };
}

function findParagraphByParaId(archive: DocxArchive, paraId: string): Element | null {
  const all = listParagraphs(archive);
  for (const { paraId: id, element } of all) {
    if (id === paraId) return element;
  }
  return null;
}

// Re-exported for the public barrel.
export { listDirectSdts };
