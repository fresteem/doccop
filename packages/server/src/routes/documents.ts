/**
 * `/v1/documents` endpoints — the render pipeline.
 *
 *   POST /v1/documents               render a template against parties (Idempotency-Key)
 *   GET  /v1/documents               list user's generated documents
 *   GET  /v1/documents/:id           download docx
 */

import {
  AuthForbiddenError,
  IdempotencyConflictError,
  PlaceholderNotFoundError,
  parse,
  render,
} from "@doccop/core";
import type { FastifyInstance } from "fastify";
import type { DoccopServerConfig } from "../config.js";
import { InMemoryRateLimiter } from "../middleware/rate-limit.js";
import { DocumentIdParamSchema, DocumentRenderSchema } from "../schemas.js";

export function registerDocumentRoutes(app: FastifyInstance, cfg: DoccopServerConfig): void {
  // Rate limiter lives for the lifetime of the plugin instance.
  const limiter = new InMemoryRateLimiter({
    maxConcurrent: cfg.maxConcurrentRendersPerUser ?? 5,
    maxPerMinute: cfg.rateLimitPerMinute ?? 60,
  });

  // ── POST /v1/documents ───────────────────────────────────────────────
  app.post("/documents", async (req, reply) => {
    const body = DocumentRenderSchema.parse(req.body);
    const idemKey = req.headers["idempotency-key"];
    const idemKeyStr = typeof idemKey === "string" && idemKey.trim() ? idemKey : null;

    if (!(await cfg.auth.canRenderTemplate(req.userId, body.templateId))) {
      throw new AuthForbiddenError(`render template ${body.templateId}`);
    }

    // ── Idempotency check ──────────────────────────────────────────────
    if (idemKeyStr) {
      const existing = await cfg.idempotency.lookup(idemKeyStr, req.userId);
      if (existing) {
        const doc = await cfg.documents.get(existing);
        if (!doc) {
          // Idempotency row points at a deleted/missing document — treat
          // as a conflict so the client knows the cached result is gone.
          throw new IdempotencyConflictError(idemKeyStr);
        }
        reply.status(200).send({ document: doc, cached: true });
        return;
      }
    }

    // ── Rate limit ─────────────────────────────────────────────────────
    const release = limiter.acquire(req.userId);
    if (!release) {
      reply.status(429).send({
        error: { code: "RATE_LIMITED", message: "Too many render requests" },
      });
      return;
    }

    try {
      // ── Load template ─────────────────────────────────────────────────
      const tpl = await cfg.templates.get(body.templateId);
      if (!tpl?.currentVersionId) throw new PlaceholderNotFoundError(body.templateId);
      const ver = await cfg.templateVersions.get(tpl.currentVersionId);
      if (!ver) throw new PlaceholderNotFoundError(tpl.currentVersionId);
      const templateBytes = await cfg.storage.loadTemplate(ver.storagePath);
      const archive = parse(templateBytes);

      // ── Allocate number + assemble request ────────────────────────────
      const now = new Date();
      const documentNumber = await cfg.numbering.allocate({
        userId: req.userId,
        templateCategory: tpl.categoryId,
        year: now.getFullYear(),
        parties: body.parties,
      });

      const renderRequest = {
        userId: req.userId,
        templateId: tpl.id,
        templateVersionId: ver.id,
        templateCategory: tpl.categoryId,
        documentNumber,
        parties: body.parties,
        now,
      };

      const dataTypes = await cfg.dataTypes.snapshot();
      const renderConfig = {
        resolvers: cfg.resolvers,
        ...(cfg.requisitesResolver ? { requisitesResolver: cfg.requisitesResolver } : {}),
        options: {
          strict: body.strict ?? cfg.strictRender ?? true,
        },
      };

      // ── Render ────────────────────────────────────────────────────────
      const result = await render(archive, renderRequest, renderConfig, dataTypes);

      // ── Persist artefact ─────────────────────────────────────────────
      const name = cfg.naming.format({
        number: documentNumber,
        templateName: tpl.name,
        templateCategory: tpl.categoryId,
        parties: body.parties,
        now,
      });
      const storagePath = await cfg.storage.saveDocument(result.docx, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ownerId: req.userId,
        suggestedName: `${name}.docx`,
      });
      const doc = await cfg.documents.create({
        templateId: tpl.id,
        templateVersionId: ver.id,
        parties: body.parties,
        variablesSnapshot: result.resolvedValues,
        number: documentNumber,
        name,
        storagePath,
        sizeBytes: result.docx.byteLength,
        createdBy: req.userId,
      });

      // ── Persist idempotency row ──────────────────────────────────────
      if (idemKeyStr) {
        await cfg.idempotency.store(idemKeyStr, req.userId, doc.id);
      }

      reply.status(201).send({
        document: doc,
        warnings: result.warnings,
        durationMs: result.durationMs,
      });
    } finally {
      release();
    }
  });

  // ── GET /v1/documents ────────────────────────────────────────────────
  app.get("/documents", async (req) => {
    const docs = await cfg.documents.listByOwner(req.userId);
    return { documents: docs };
  });

  // ── GET /v1/documents/:id ───────────────────────────────────────────
  app.get("/documents/:id", async (req, reply) => {
    const { id } = DocumentIdParamSchema.parse(req.params);
    const doc = await cfg.documents.get(id);
    if (!doc) throw new PlaceholderNotFoundError(id);
    if (doc.createdBy !== req.userId) {
      throw new AuthForbiddenError(`download document ${id}`);
    }
    const bytes = await cfg.storage.loadDocument(doc.storagePath);
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .header("content-disposition", `attachment; filename="${encodeURIComponent(doc.name)}.docx"`)
      .send(Buffer.from(bytes));
  });
}
