/**
 * Public surface of the requisites subsystem.
 */

export {
  injectRequisites,
  resolveAndInject,
  serializeArchive,
} from "./RequisitesEngine.js";
export type { InjectionRequest } from "./RequisitesEngine.js";
export { rewriteSnippetTags } from "./TagRewriter.js";
export {
  remapSnippetStyles,
  mergeStylesIntoMaster,
} from "./StyleRemapper.js";
export type { StyleRemapResult } from "./StyleRemapper.js";
export {
  remapSnippetNumbering,
  mergeNumberingIntoMaster,
} from "./NumberingRemapper.js";
export type { NumberingRemapResult } from "./NumberingRemapper.js";
export { remapSnippetBookmarks } from "./BookmarkRemapper.js";
export type { BookmarkRemapResult } from "./BookmarkRemapper.js";
export { injectSnippetBody } from "./XmlInjector.js";
export {
  parseAuxiliaryParts,
  writeAuxiliaryParts,
  PART_PATHS,
} from "./SnippetArchive.js";
export type { AuxiliaryParts } from "./SnippetArchive.js";
