/**
 * Multipart file-upload helper.
 *
 * Wraps `@fastify/multipart` to surface a single uploaded file alongside
 * the form's text fields. Enforces a byte cap upfront so the engine
 * never sees an oversized blob.
 */

import { TemplateTooLargeError } from "@doccop/core";
import type { FastifyRequest } from "fastify";

export interface UploadedFile {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  /** Form-text fields, by name. */
  fields: Record<string, string | undefined>;
}

/**
 * Extract the (one) file part + text fields from a `multipart/form-data`
 * request. Throws `TemplateTooLargeError` when the file exceeds
 * `maxBytes`.
 *
 * The host is expected to register `@fastify/multipart` on the server
 * instance before mounting the doccop plugin.
 */
export async function fileFromMultipart(
  req: FastifyRequest,
  maxBytes: number,
): Promise<UploadedFile> {
  // `req.file()` is augmented by @fastify/multipart at registration time.
  // The package's types declare the augmentation; we cast through `unknown`
  // to avoid coupling the doccop server's compile-time graph to a specific
  // multipart version.
  const fileFn = (req as unknown as { file?: () => Promise<unknown> }).file;
  if (typeof fileFn !== "function") {
    throw new Error("@fastify/multipart not registered on the Fastify instance");
  }
  const part = (await fileFn.call(req)) as {
    filename?: string;
    mimetype?: string;
    file: AsyncIterable<Buffer>;
    fields?: Record<string, { value?: unknown }>;
  } | null;
  if (!part) {
    throw new Error("expected a multipart file field");
  }
  const fields: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(part.fields ?? {})) {
    if (value && typeof value === "object" && "value" in value) {
      fields[name] = String(value.value);
    }
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of part.file) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new TemplateTooLargeError(total, maxBytes);
    }
    chunks.push(chunk);
  }
  return {
    filename: (part as { filename?: string }).filename ?? "upload",
    mimeType: (part as { mimetype?: string }).mimetype ?? "application/octet-stream",
    bytes: new Uint8Array(Buffer.concat(chunks)),
    fields,
  };
}
