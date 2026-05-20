/**
 * Types for the placeholder editing subsystem.
 *
 * The engine treats a placeholder location as a positional triple
 * (paragraph anchor + run index + character offset). These come from
 * the browser's text-selection API which the preview renderer's
 * `data-anchor-id` / `data-run-index` attributes already expose.
 */

import type { DataType } from "../types.js";

/**
 * Range of text inside a single paragraph, expressed in terms the
 * preview renderer's HTML guarantees. `runIndex` counts only `<w:r>`
 * children (the same index that lands on `data-run-index` in the
 * rendered HTML); intervening `<w:sdt>` siblings do not advance it.
 *
 * Offsets are character counts into the run's single `<w:t>` element.
 * If a run contains anything other than one `<w:t>` (e.g. a tab inside),
 * wrap() will refuse to split it — selection must avoid that run or end
 * on its boundary.
 */
export interface WrapLocation {
  /** `w14:paraId` of the paragraph that contains the selection. */
  paraId: string;
  /** Run index (0-based) within the paragraph where the selection starts. */
  startRunIndex: number;
  /** Character offset into the start run's text where the selection starts. */
  startOffset: number;
  /** Run index (inclusive) where the selection ends. */
  endRunIndex: number;
  /**
   * Character offset where the selection ends. May equal the end run's
   * text length to mean "through the end of the run".
   */
  endOffset: number;
}

/**
 * Inclusive range of paragraphs to wrap into a block-level `<w:sdt>`.
 * Used by `wrapBlock` to mark whole-paragraph regions as
 * `requisites:party_X` injection points.
 *
 * Both paraIds must refer to paragraphs that share the same direct
 * parent, and that parent must be one of:
 *
 * - `<w:body>` — top-level paragraphs (the common case);
 * - `<w:tc>`   — paragraphs inside a single table cell (common in
 *                Ukrainian legal templates where the "requisites" block
 *                lives inside a layout table);
 * - `<w:sdtContent>` — nested inside another (non-requisites) block
 *                SDT. Wrapping inside a `requisites:*` SDT is rejected
 *                with `OverlappingPlaceholderError` (no recursion).
 *
 * The range walks `startParaId.nextSibling` until it reaches `endParaId`;
 * any non-SDT siblings encountered (additional paragraphs, tables) are
 * pulled into the new SDT alongside the bounds. Hitting an existing SDT
 * mid-range is rejected as an overlap.
 *
 * `startParaId === endParaId` is allowed (single-paragraph block).
 */
export interface BlockWrapLocation {
  /** `w14:paraId` of the first paragraph in the inclusive range. */
  startParaId: string;
  /** `w14:paraId` of the last paragraph in the inclusive range. */
  endParaId: string;
}

/**
 * Specification for a new placeholder. The engine validates `tag` and
 * `alias` then writes them into `<w:sdtPr>`. `dataType` is recorded in
 * the engine's Placeholder catalogue for runtime validation but is not
 * stored in the SDT itself (Word would ignore it).
 */
export interface PlaceholderSpec {
  /**
   * Full tag identifier. Two accepted shapes:
   *   - `<scope>.<key>` for value placeholders, e.g. `party_a.full_name`,
   *     `system.today`, `custom.contract_amount`.
   *   - `requisites:party_<id>` for block-level requisite injection
   *     markers, e.g. `requisites:party_a`.
   */
  tag: string;
  /** Friendly label shown in the preview and to template editors. */
  alias: string;
  /** Expected runtime type of the resolved value. */
  dataType: DataType;
}
