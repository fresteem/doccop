/**
 * @doccop/core — engine entry point.
 *
 * Exports the full v1 surface:
 *  - Types and errors (Waves 1-6).
 *  - docx subsystem: parse / serialize / paragraph anchors.
 *  - placeholders: list / wrap / unwrap / replace, tag validation.
 *  - preview: HTML renderer with anchor map.
 *  - render: DocxRenderer + type validators.
 *  - requisites: snippet injection.
 */

// ─── docx subsystem ──────────────────────────────────────────────────────
export { parse, serialize, type ParseOptions } from "./docx/DocxParser.js";
export { ensureParaIds, findByParaId, listParagraphs } from "./docx/AnchorMapper.js";
export type { DocxArchive, EnsureParaIdsResult } from "./docx/types.js";
export {
  W_NS,
  W14_NS,
  OOXML_NAMESPACES,
  findElements,
  parseXmlSafely,
  serializeXml,
  ensureNamespaceOnRoot,
} from "./docx/xml-utils.js";

// ─── preview subsystem ───────────────────────────────────────────────────
export { render as preview } from "./preview/HtmlRenderer.js";
export type { RenderedHtml, AnchorMap, AnchorParagraph, AnchorSdt } from "./preview/types.js";

// ─── placeholders subsystem ──────────────────────────────────────────────
export {
  list,
  wrap,
  wrapBareKey,
  wrapBlock,
  unwrap,
  replace,
} from "./placeholders/PlaceholderEngine.js";
export type { ListOptions } from "./placeholders/PlaceholderEngine.js";
export {
  BARE_KEY_PATTERN,
  decomposeTag,
  validateAlias,
  validateBareKey,
} from "./placeholders/TagValidator.js";
export type { DecomposedTag } from "./placeholders/TagValidator.js";
export type {
  BareKeyPlaceholderSpec,
  BlockWrapLocation,
  WrapLocation,
  PlaceholderSpec,
} from "./placeholders/types.js";
export { compileTextTokens } from "./placeholders/TextTokenCompiler.js";
export type {
  CompileTextTokensOptions,
  CompileTextTokensResult,
  CompiledToken,
  SkippedToken,
} from "./placeholders/TextTokenCompiler.js";

// ─── render subsystem ────────────────────────────────────────────────────
export { render } from "./render/DocxRenderer.js";
export { validateValue } from "./render/typeValidators.js";
export type { RenderRequest, RenderConfig } from "./render/types.js";

// ─── requisites subsystem ────────────────────────────────────────────────
export {
  injectRequisites,
  resolveAndInject,
  serializeArchive,
} from "./requisites/RequisitesEngine.js";
export type { InjectionRequest } from "./requisites/RequisitesEngine.js";

export type {
  AllocateContext,
  AuthAdapter,
  DataType,
  DocCopConfig,
  EngineLimits,
  EntityId,
  EntityResolver,
  EntitySubtype,
  EntityType,
  Logger,
  NamingContext,
  NamingService,
  NumberingService,
  PartyRef,
  Placeholder,
  RenderOptions,
  RenderResult,
  RenderWarning,
  RequisitesResolver,
  ResolveContext,
  ResolvedValue,
  SaveDocumentHint,
  StorageAdapter,
  TemplateSnippet,
  UserId,
  VariableScope,
} from "./types.js";

export { NoopLogger } from "./types.js";

export {
  AbsentValueInStrictModeError,
  AuthForbiddenError,
  DocCopError,
  type DocCopErrorCode,
  IdempotencyConflictError,
  InternalError,
  InvalidPlaceholderTagError,
  MalformedDocxError,
  NoResolverForScopeError,
  OverlappingPlaceholderError,
  PlaceholderNotFoundError,
  RenderTimeoutError,
  ResolverFailedError,
  SnippetCannotContainRequisitesError,
  SnippetTooLargeError,
  StorageFailedError,
  TemplateTooLargeError,
  TooManyPlaceholdersError,
  TypeValidationFailedError,
  VersionConflictError,
  XxeDetectedError,
} from "./errors.js";
