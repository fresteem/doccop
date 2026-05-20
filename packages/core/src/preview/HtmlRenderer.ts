/**
 * .docx → HTML preview renderer.
 *
 * Walks `word/document.xml` and emits an HTML fragment annotated with
 * stable anchor IDs (`data-anchor-id="<paraId>"`, `data-run-index="N"`,
 * etc.). The UI layer in Wave 14 uses these annotations to:
 *
 *   1. Render the document in the template editor.
 *   2. Translate browser text-selection ranges back into precise
 *      OOXML positions for placeholder wrapping (Wave 4).
 *   3. Highlight existing placeholders so the editor can act on them.
 *
 * The rendered HTML is a body-only fragment. It is NOT a styled WYSIWYG
 * render — there is no theme resolution, no styles.xml inheritance, no
 * font-family lookup. Our goal is "looks reasonable for editing" not
 * "matches Word pixel-perfect".
 *
 * Security: every string that originates in the document (text, tag,
 * alias) flows through `escapeHtml` or `escapeAttr` before joining the
 * output buffer.
 */

import type { Element, Node } from "@xmldom/xmldom";
import { listParagraphs } from "../docx/AnchorMapper.js";
import type { DocxArchive } from "../docx/types.js";
import { W14_NS, W_NS, findElements } from "../docx/xml-utils.js";
import { escapeAttr, escapeHtml } from "./escape.js";
import { paraStyleToCss, runStyleToCss } from "./style-mapper.js";
import type { AnchorMap, AnchorParagraph, AnchorSdt, RenderedHtml } from "./types.js";

/**
 * Render a parsed docx archive to an HTML preview fragment.
 *
 * Pre-condition: `archive.document` should already have stable paraIds
 * (call `AnchorMapper.ensureParaIds` first). If a paragraph lacks a
 * paraId, the renderer emits it without `data-anchor-id` — the UI will
 * not be able to anchor placeholders to it, but the preview still works.
 */
export function render(archive: DocxArchive): RenderedHtml {
  const root = archive.document.documentElement;
  if (!root) {
    return {
      html: '<div class="doccop-document"></div>',
      anchors: { paragraphs: [], blockSdts: [] },
    };
  }
  const bodies = findElements(root, W_NS, "body");
  const body = bodies[0];
  if (!body) {
    return {
      html: '<div class="doccop-document"></div>',
      anchors: { paragraphs: [], blockSdts: [] },
    };
  }

  const ctx: RenderContext = {
    out: [],
    anchors: { paragraphs: [], blockSdts: [] },
  };

  ctx.out.push('<div class="doccop-document">');
  renderChildren(body, ctx);
  ctx.out.push("</div>");

  return { html: ctx.out.join(""), anchors: ctx.anchors };
}

// ─── Internal walker ────────────────────────────────────────────────────────

interface RenderContext {
  /** Output buffer. */
  out: string[];
  /** Accumulated anchor metadata. */
  anchors: AnchorMap;
}

/**
 * Iterate direct children of `parent` and dispatch each recognised
 * OOXML element to its renderer. Unknown elements are silently skipped
 * (Word's part-table has dozens of elements we don't model — page
 * breaks, comments range start/end, bookmarks, etc).
 */
function renderChildren(parent: Element, ctx: RenderContext): void {
  for (const child of directChildren(parent)) {
    if (child.namespaceURI !== W_NS) continue;
    switch (child.localName) {
      case "p":
        renderParagraph(child, ctx);
        break;
      case "tbl":
        renderTable(child, ctx);
        break;
      case "sdt":
        renderSdt(child, ctx);
        break;
      // Anything else (sectPr, sdt-children rendered out-of-line, etc.) is
      // skipped — we either don't care or it's handled by a parent dispatch.
      default:
        break;
    }
  }
}

function renderParagraph(p: Element, ctx: RenderContext): void {
  const paraId = p.getAttributeNS(W14_NS, "paraId");
  const pPr = directChild(p, W_NS, "pPr");
  const css = paraStyleToCss(pPr);

  const anchorAttr = paraId ? ` data-anchor-id="${escapeAttr(paraId)}"` : "";
  const styleAttr = css ? ` style="${escapeAttr(css)}"` : "";
  ctx.out.push(`<p class="doccop-para"${anchorAttr}${styleAttr}>`);

  const sdtsInPara: AnchorSdt[] = [];
  let runIndex = 0;
  for (const child of directChildren(p)) {
    if (child.namespaceURI !== W_NS) continue;
    switch (child.localName) {
      case "r":
        renderRun(child, ctx, runIndex);
        runIndex++;
        break;
      case "sdt": {
        const sdt = renderInlineSdt(child, ctx);
        if (sdt) {
          sdtsInPara.push({ ...sdt, indexInPara: runIndex, block: false });
        }
        runIndex++;
        break;
      }
      // pPr, bookmarkStart, etc. — non-content, skip.
      default:
        break;
    }
  }

  ctx.out.push("</p>");

  if (paraId) {
    const entry: AnchorParagraph = { paraId, sdts: sdtsInPara };
    ctx.anchors.paragraphs.push(entry);
  }
}

function renderRun(r: Element, ctx: RenderContext, runIndex: number): void {
  const rPr = directChild(r, W_NS, "rPr");
  const css = runStyleToCss(rPr);
  const styleAttr = css ? ` style="${escapeAttr(css)}"` : "";
  ctx.out.push(`<span class="doccop-run" data-run-index="${runIndex}"${styleAttr}>`);
  renderRunContent(r, ctx);
  ctx.out.push("</span>");
}

/**
 * Walk a run's text content emitting each piece. A run may contain
 * multiple `<w:t>` text segments, `<w:tab/>` tabs, `<w:br/>` breaks,
 * etc. We render them in document order so split runs reassemble
 * correctly.
 */
function renderRunContent(r: Element, ctx: RenderContext): void {
  for (const child of directChildren(r)) {
    if (child.namespaceURI !== W_NS) continue;
    switch (child.localName) {
      case "t":
        ctx.out.push(escapeHtml(textContent(child)));
        break;
      case "tab":
        ctx.out.push('<span class="doccop-tab">\t</span>');
        break;
      case "br": {
        const type = child.getAttributeNS(W_NS, "type");
        if (type === "page") {
          ctx.out.push('<span class="doccop-page-break"></span>');
        } else {
          ctx.out.push("<br/>");
        }
        break;
      }
      // <w:rPr>, <w:noBreakHyphen>, <w:softHyphen>, <w:sym>, etc. — skip.
      default:
        break;
    }
  }
}

// ─── SDT (placeholder) rendering ───────────────────────────────────────────

interface SdtMeta {
  tag: string;
  alias: string;
}

/**
 * Render an SDT element. We distinguish three shapes:
 *
 * 1. Inline SDT inside a paragraph → handled by `renderInlineSdt`.
 * 2. Block SDT containing whole paragraphs → renders as a block
 *    placeholder marker; the contained content is not shown (preview
 *    only — the actual render later will substitute it).
 * 3. SDT at top level with no clear inside/outside structure → fallback
 *    to block style.
 */
function renderSdt(sdt: Element, ctx: RenderContext): void {
  // At the top-level (between paragraphs), an SDT is always block.
  const meta = readSdtMeta(sdt);
  if (!meta) return;

  const sdtContent = directChild(sdt, W_NS, "sdtContent");
  const containedParaIds: string[] = [];
  if (sdtContent) {
    for (const para of listParagraphsIn(sdtContent)) {
      const id = para.getAttributeNS(W14_NS, "paraId");
      if (id) containedParaIds.push(id);
    }
  }

  ctx.anchors.blockSdts.push({
    tag: meta.tag,
    alias: meta.alias,
    paraIds: containedParaIds,
  });

  ctx.out.push(
    `<div class="doccop-placeholder doccop-placeholder--block" data-tag="${escapeAttr(
      meta.tag,
    )}" data-alias="${escapeAttr(meta.alias)}">[${escapeHtml(meta.alias)}]</div>`,
  );
}

function renderInlineSdt(sdt: Element, ctx: RenderContext): SdtMeta | null {
  const meta = readSdtMeta(sdt);
  if (!meta) return null;
  ctx.out.push(
    `<span class="doccop-placeholder doccop-placeholder--inline" data-tag="${escapeAttr(
      meta.tag,
    )}" data-alias="${escapeAttr(meta.alias)}">${escapeHtml(meta.alias)}</span>`,
  );
  return meta;
}

/** Extract tag + alias from `<w:sdtPr>`. Tag is required; alias falls back to tag. */
function readSdtMeta(sdt: Element): SdtMeta | null {
  const sdtPr = directChild(sdt, W_NS, "sdtPr");
  if (!sdtPr) return null;
  const tagEl = directChild(sdtPr, W_NS, "tag");
  const tag = tagEl?.getAttributeNS(W_NS, "val");
  if (!tag) return null;
  const aliasEl = directChild(sdtPr, W_NS, "alias");
  const alias = aliasEl?.getAttributeNS(W_NS, "val") ?? tag;
  return { tag, alias };
}

// ─── Tables ────────────────────────────────────────────────────────────────

function renderTable(tbl: Element, ctx: RenderContext): void {
  ctx.out.push('<table class="doccop-tbl"><tbody>');
  for (const child of directChildren(tbl)) {
    if (child.namespaceURI !== W_NS) continue;
    if (child.localName === "tr") renderRow(child, ctx);
  }
  ctx.out.push("</tbody></table>");
}

function renderRow(tr: Element, ctx: RenderContext): void {
  ctx.out.push('<tr class="doccop-tr">');
  for (const child of directChildren(tr)) {
    if (child.namespaceURI !== W_NS) continue;
    if (child.localName === "tc") renderCell(child, ctx);
  }
  ctx.out.push("</tr>");
}

function renderCell(tc: Element, ctx: RenderContext): void {
  ctx.out.push('<td class="doccop-tc">');
  // Cells contain block content — paragraphs, nested tables, SDTs.
  renderChildren(tc, ctx);
  ctx.out.push("</td>");
}

// ─── DOM walking helpers ───────────────────────────────────────────────────

/** Yield direct Element children (skipping text / comment nodes). */
function* directChildren(parent: Element): Generator<Element> {
  let n: Node | null = parent.firstChild;
  while (n) {
    // ELEMENT_NODE = 1 per the DOM spec.
    if (n.nodeType === 1) yield n as Element;
    n = n.nextSibling;
  }
}

/** First direct child element matching (namespace, localName). */
function directChild(parent: Element, nsUri: string, localName: string): Element | null {
  for (const c of directChildren(parent)) {
    if (c.namespaceURI === nsUri && c.localName === localName) return c;
  }
  return null;
}

/** Concatenated text content from a `<w:t>` element, preserving whitespace. */
function textContent(el: Element): string {
  // <w:t xml:space="preserve">  ABC  </w:t> — we keep whitespace as-is;
  // browsers normalise it only when CSS `white-space` is not preserve.
  let s = "";
  let n: Node | null = el.firstChild;
  while (n) {
    if (n.nodeType === 3) {
      // TEXT_NODE
      s += n.nodeValue ?? "";
    }
    n = n.nextSibling;
  }
  return s;
}

/** Paragraphs that are direct descendants (recursively) of `parent`. */
function listParagraphsIn(parent: Element): Element[] {
  // `getElementsByTagNameNS` recurses to all descendants — fine for our
  // SDT-content case (a block SDT may contain nested structures).
  return findElements(parent, W_NS, "p");
}

// Re-export listParagraphs for tests that want a quick reality check.
export { listParagraphs };
