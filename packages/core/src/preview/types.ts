/**
 * Types for the HTML preview subsystem.
 *
 * The preview renderer produces HTML for in-browser editing. Higher
 * layers (the React TemplateEditor in Wave 14) attach interactivity via
 * the anchor map: which paragraphs/runs the user clicked, which SDTs
 * already exist, where new ones should go.
 */

/**
 * One placeholder (SDT) discovered inside a paragraph or as a block.
 */
export interface AnchorSdt {
  /** Engine binding (e.g. `"party_a.full_name"`, `"requisites:party_a"`). */
  tag: string;
  /** Friendly label shown to template editors. */
  alias: string;
  /**
   * Position within the paragraph for inline SDTs (0-based among
   * siblings the renderer emits). Always `null` for block-level SDTs,
   * which sit between paragraphs.
   */
  indexInPara: number | null;
  /** `true` when this SDT wraps whole paragraphs; `false` for inline. */
  block: boolean;
}

/**
 * Per-paragraph anchor metadata. Use to attach UI interactions to the
 * rendered HTML — every `<p data-anchor-id="...">` in the output has a
 * matching entry here.
 */
export interface AnchorParagraph {
  paraId: string;
  /** SDTs that live inside this paragraph (inline) — empty for plain paragraphs. */
  sdts: AnchorSdt[];
}

/**
 * The anchor map for a rendered document. Block-level SDTs that sit
 * *between* paragraphs are listed at the top level under `blockSdts`,
 * keyed by the paragraph they precede.
 */
export interface AnchorMap {
  /** Paragraph metadata, in document order. */
  paragraphs: AnchorParagraph[];
  /**
   * Block-level SDTs that span multiple paragraphs (e.g. `requisites:*`).
   * Each entry references the paraIds of the paragraphs the SDT contains.
   */
  blockSdts: Array<{
    tag: string;
    alias: string;
    /** paraIds (in order) of the paragraphs wrapped by this block SDT. */
    paraIds: string[];
  }>;
}

/** Output of the HTML renderer. */
export interface RenderedHtml {
  /** HTML fragment (no doctype, no `<html>`/`<body>` — just content). */
  html: string;
  /** Per-paragraph anchor metadata. */
  anchors: AnchorMap;
}
