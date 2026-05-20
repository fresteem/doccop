/**
 * Public surface of the docx subsystem. Anything outside `src/docx/`
 * imports from here, not from individual modules — this keeps the
 * subsystem's internal layout free to evolve.
 */

export { parse, serialize, type ParseOptions } from "./DocxParser.js";
export { ensureParaIds, findByParaId, listParagraphs } from "./AnchorMapper.js";
export type { DocxArchive, EnsureParaIdsResult } from "./types.js";
export {
  W_NS,
  W14_NS,
  OOXML_NAMESPACES,
  findElements,
  parseXmlSafely,
  serializeXml,
  ensureNamespaceOnRoot,
} from "./xml-utils.js";
