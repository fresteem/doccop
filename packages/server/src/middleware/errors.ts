/**
 * Map `DocCopError` subclasses onto HTTP status codes + a structured
 * JSON body. The host can override this with its own error handler if
 * it wants a different envelope, but the defaults cover every code the
 * engine ever throws.
 */

import { DocCopError, type DocCopErrorCode } from "@doccop/core";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** HTTP status for each engine error code. */
const STATUS_BY_CODE: Record<DocCopErrorCode, number> = {
  MALFORMED_DOCX: 400,
  TEMPLATE_TOO_LARGE: 413,
  SNIPPET_TOO_LARGE: 413,
  TOO_MANY_PLACEHOLDERS: 422,
  XXE_DETECTED: 400,
  INVALID_PLACEHOLDER_TAG: 400,
  OVERLAPPING_PLACEHOLDER: 409,
  PLACEHOLDER_NOT_FOUND: 404,
  SNIPPET_CANNOT_CONTAIN_REQUISITES: 422,
  NO_RESOLVER_FOR_SCOPE: 422,
  RESOLVER_FAILED: 502,
  ABSENT_VALUE_IN_STRICT_MODE: 422,
  TYPE_VALIDATION_FAILED: 422,
  RENDER_TIMEOUT: 504,
  STORAGE_FAILED: 502,
  AUTH_FORBIDDEN: 403,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export function fastifyErrorHandler(
  err: FastifyError | Error,
  _req: FastifyRequest,
  reply: FastifyReply,
): void {
  if (err instanceof DocCopError) {
    const status = STATUS_BY_CODE[err.code] ?? 500;
    const body: ErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        details: { ...err.details },
      },
    };
    reply.status(status).send(body);
    return;
  }
  // Fastify-native errors (validation failures etc.) — keep their status.
  const fastifyErr = err as FastifyError;
  if (fastifyErr.statusCode && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 600) {
    reply.status(fastifyErr.statusCode).send({
      error: {
        code: fastifyErr.code ?? "FASTIFY_ERROR",
        message: fastifyErr.message,
      },
    });
    return;
  }
  // Anything else is an unhandled bug — log + 500.
  reply.log?.error({ err }, "unhandled error");
  reply.status(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
  });
}
