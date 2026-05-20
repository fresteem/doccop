/**
 * @doccop/core — engine entry point.
 *
 * Wave 1 ships only the public type and error contracts. Implementation
 * modules (DocxParser, AnchorMapper, PlaceholderEngine, DocxRenderer,
 * RequisitesEngine, DocCop class) land in Waves 2-6.
 */

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
