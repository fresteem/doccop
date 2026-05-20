/**
 * Typed error hierarchy for @doccop/core.
 *
 * Every error the engine throws extends `DocCopError`. Callers can branch
 * on `error.code` (string-typed) for handling, or `instanceof` on the
 * specific subclass when a particular error matters.
 *
 * Conventions:
 * - Codes are SCREAMING_SNAKE_CASE.
 * - Messages are English (UI translation lives in the host application).
 * - Each subclass declares `readonly code` for narrowing.
 */

export type DocCopErrorCode =
  | "MALFORMED_DOCX"
  | "TEMPLATE_TOO_LARGE"
  | "SNIPPET_TOO_LARGE"
  | "TOO_MANY_PLACEHOLDERS"
  | "XXE_DETECTED"
  | "INVALID_PLACEHOLDER_TAG"
  | "OVERLAPPING_PLACEHOLDER"
  | "PLACEHOLDER_NOT_FOUND"
  | "SNIPPET_CANNOT_CONTAIN_REQUISITES"
  | "NO_RESOLVER_FOR_SCOPE"
  | "RESOLVER_FAILED"
  | "ABSENT_VALUE_IN_STRICT_MODE"
  | "TYPE_VALIDATION_FAILED"
  | "RENDER_TIMEOUT"
  | "STORAGE_FAILED"
  | "AUTH_FORBIDDEN"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";

/**
 * Base class. Use this in `catch` blocks to filter "expected" engine errors
 * from genuine bugs.
 */
export class DocCopError extends Error {
  public readonly code: DocCopErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DocCopErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = Object.freeze({ ...details });
    // Restore prototype chain on transpilation targets that lose it.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Parsing & validation ──────────────────────────────────────────────────

/** The uploaded bytes aren't a valid .docx archive. */
export class MalformedDocxError extends DocCopError {
  public override readonly code = "MALFORMED_DOCX" as const;
  constructor(detail: string, cause?: unknown) {
    super("MALFORMED_DOCX", `Malformed .docx: ${detail}`, { cause: String(cause ?? "") });
  }
}

/** Template exceeds the configured size limit. */
export class TemplateTooLargeError extends DocCopError {
  public override readonly code = "TEMPLATE_TOO_LARGE" as const;
  constructor(actualBytes: number, maxBytes: number) {
    super("TEMPLATE_TOO_LARGE", `Template is ${actualBytes} bytes, exceeds limit of ${maxBytes}`, {
      actualBytes,
      maxBytes,
    });
  }
}

/** Snippet exceeds the configured size limit. */
export class SnippetTooLargeError extends DocCopError {
  public override readonly code = "SNIPPET_TOO_LARGE" as const;
  constructor(actualBytes: number, maxBytes: number) {
    super("SNIPPET_TOO_LARGE", `Snippet is ${actualBytes} bytes, exceeds limit of ${maxBytes}`, {
      actualBytes,
      maxBytes,
    });
  }
}

/** Template has more placeholders than allowed. */
export class TooManyPlaceholdersError extends DocCopError {
  public override readonly code = "TOO_MANY_PLACEHOLDERS" as const;
  constructor(actualCount: number, maxCount: number) {
    super(
      "TOO_MANY_PLACEHOLDERS",
      `Template has ${actualCount} placeholders, exceeds limit of ${maxCount}`,
      { actualCount, maxCount },
    );
  }
}

/** XML contained an external entity reference — possible XXE attack. */
export class XxeDetectedError extends DocCopError {
  public override readonly code = "XXE_DETECTED" as const;
  constructor(entityName: string) {
    super(
      "XXE_DETECTED",
      `XML contains external entity '${entityName}'. External entities are disallowed for security.`,
      { entityName },
    );
  }
}

/** Placeholder tag doesn't match the expected `scope.key` format. */
export class InvalidPlaceholderTagError extends DocCopError {
  public override readonly code = "INVALID_PLACEHOLDER_TAG" as const;
  constructor(tag: string, reason: string) {
    super("INVALID_PLACEHOLDER_TAG", `Invalid placeholder tag '${tag}': ${reason}`, {
      tag,
      reason,
    });
  }
}

// ─── Placeholder editing ───────────────────────────────────────────────────

/** Selection to be wrapped overlaps an existing SDT. */
export class OverlappingPlaceholderError extends DocCopError {
  public override readonly code = "OVERLAPPING_PLACEHOLDER" as const;
  constructor(existingTag: string) {
    super(
      "OVERLAPPING_PLACEHOLDER",
      `Selection overlaps existing placeholder '${existingTag}'. Remove it first.`,
      { existingTag },
    );
  }
}

/** Tag not found when attempting to unwrap or replace. */
export class PlaceholderNotFoundError extends DocCopError {
  public override readonly code = "PLACEHOLDER_NOT_FOUND" as const;
  constructor(tag: string) {
    super("PLACEHOLDER_NOT_FOUND", `No placeholder with tag '${tag}' in this template.`, { tag });
  }
}

/** A snippet docx contained a `requisites:*` SDT (recursion forbidden). */
export class SnippetCannotContainRequisitesError extends DocCopError {
  public override readonly code = "SNIPPET_CANNOT_CONTAIN_REQUISITES" as const;
  constructor(foundTag: string) {
    super(
      "SNIPPET_CANNOT_CONTAIN_REQUISITES",
      `Snippet contains '${foundTag}' — snippets may not nest requisite blocks.`,
      { foundTag },
    );
  }
}

// ─── Rendering ─────────────────────────────────────────────────────────────

/** No resolver registered for the placeholder's scope. */
export class NoResolverForScopeError extends DocCopError {
  public override readonly code = "NO_RESOLVER_FOR_SCOPE" as const;
  constructor(scope: string, tag: string) {
    super(
      "NO_RESOLVER_FOR_SCOPE",
      `No resolver registered for scope '${scope}' (placeholder '${tag}')`,
      { scope, tag },
    );
  }
}

/** Resolver threw or returned an invalid value. */
export class ResolverFailedError extends DocCopError {
  public override readonly code = "RESOLVER_FAILED" as const;
  constructor(tag: string, cause: unknown) {
    super("RESOLVER_FAILED", `Resolver for '${tag}' failed: ${String(cause)}`, {
      tag,
      cause: String(cause),
    });
  }
}

/** Resolver returned `absent` and strict mode is on. */
export class AbsentValueInStrictModeError extends DocCopError {
  public override readonly code = "ABSENT_VALUE_IN_STRICT_MODE" as const;
  constructor(tag: string, reason: string | undefined) {
    super(
      "ABSENT_VALUE_IN_STRICT_MODE",
      `No value for '${tag}'${reason ? ` (${reason})` : ""} and strict mode is enabled.`,
      { tag, reason: reason ?? null },
    );
  }
}

/** Resolved value doesn't satisfy the placeholder's declared data type. */
export class TypeValidationFailedError extends DocCopError {
  public override readonly code = "TYPE_VALIDATION_FAILED" as const;
  constructor(tag: string, expected: string, actual: string) {
    super(
      "TYPE_VALIDATION_FAILED",
      `Value for '${tag}' fails ${expected} validation: got '${actual}'`,
      { tag, expected, actual },
    );
  }
}

/** Render exceeded the configured timeout. */
export class RenderTimeoutError extends DocCopError {
  public override readonly code = "RENDER_TIMEOUT" as const;
  constructor(elapsedMs: number, limitMs: number) {
    super("RENDER_TIMEOUT", `Render exceeded ${limitMs}ms (took ${elapsedMs}ms)`, {
      elapsedMs,
      limitMs,
    });
  }
}

// ─── Adapter-level ─────────────────────────────────────────────────────────

/** Storage backend operation failed. */
export class StorageFailedError extends DocCopError {
  public override readonly code = "STORAGE_FAILED" as const;
  constructor(operation: string, cause: unknown) {
    super("STORAGE_FAILED", `Storage operation '${operation}' failed: ${String(cause)}`, {
      operation,
      cause: String(cause),
    });
  }
}

/** Auth adapter denied the action. */
export class AuthForbiddenError extends DocCopError {
  public override readonly code = "AUTH_FORBIDDEN" as const;
  constructor(action: string) {
    super("AUTH_FORBIDDEN", `Forbidden: ${action}`, { action });
  }
}

/** Optimistic-lock conflict on template version update. */
export class VersionConflictError extends DocCopError {
  public override readonly code = "VERSION_CONFLICT" as const;
  constructor(templateId: string, expected: string, actual: string) {
    super(
      "VERSION_CONFLICT",
      `Template ${templateId} has changed (expected version ${expected}, found ${actual})`,
      { templateId, expected, actual },
    );
  }
}

/** Same idempotency key used for a different payload. */
export class IdempotencyConflictError extends DocCopError {
  public override readonly code = "IDEMPOTENCY_CONFLICT" as const;
  constructor(key: string) {
    super(
      "IDEMPOTENCY_CONFLICT",
      `Idempotency key '${key}' already used with a different request.`,
      { key },
    );
  }
}

/** Catch-all for unexpected engine bugs. */
export class InternalError extends DocCopError {
  public override readonly code = "INTERNAL_ERROR" as const;
  constructor(detail: string, cause?: unknown) {
    super("INTERNAL_ERROR", `Internal engine error: ${detail}`, {
      cause: String(cause ?? ""),
    });
  }
}
