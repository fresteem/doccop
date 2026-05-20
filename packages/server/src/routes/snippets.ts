/**
 * `/v1/snippets` endpoints — per-subtype requisite blocks.
 *
 *   POST   /v1/snippets        upload .docx + (entityType, entitySubtype, name)
 *   GET    /v1/snippets        list all snippets (any visibility)
 *   DELETE /v1/snippets/:id    remove
 */

import { AuthForbiddenError, PlaceholderNotFoundError, list, parse } from "@doccop/core";
import type { FastifyInstance } from "fastify";
import type { DoccopServerConfig } from "../config.js";
import { fileFromMultipart } from "../helpers/multipart.js";
import { SnippetIdParamSchema, SnippetUploadSchema } from "../schemas.js";

export function registerSnippetRoutes(app: FastifyInstance, cfg: DoccopServerConfig): void {
  // ── POST /v1/snippets ────────────────────────────────────────────────
  app.post("/snippets", async (req, reply) => {
    if (!(await cfg.auth.canManageSnippets(req.userId))) {
      throw new AuthForbiddenError("manage snippets");
    }
    const file = await fileFromMultipart(req, cfg.maxUploadBytes ?? 10 * 1024 * 1024);
    const meta = SnippetUploadSchema.parse(parseJsonField(file.fields.meta));

    // Parse + validate the snippet (rejects malformed docx, oversize, xxe).
    const archive = parse(
      file.bytes,
      cfg.maxUploadBytes !== undefined ? { maxBytes: cfg.maxUploadBytes } : {},
    );
    const placeholders = list(archive);

    const storagePath = await cfg.storage.saveSnippet(file.bytes, req.userId);

    // upsert keys on (entityType, entitySubtype) — replacing an existing
    // snippet is the common admin workflow when iterating on a layout.
    const snip = await cfg.snippets.upsert({
      entityType: meta.entityType,
      entitySubtype: meta.entitySubtype,
      name: meta.name,
      ownerId: req.userId,
    });
    const existingVersions = snip.currentVersionId
      ? [await cfg.snippetVersions.get(snip.currentVersionId)]
      : [];
    const nextVersionNumber = (existingVersions[0]?.versionNumber ?? 0) + 1;

    const newVer = await cfg.snippetVersions.create({
      snippetId: snip.id,
      versionNumber: nextVersionNumber,
      storagePath,
      placeholders,
      createdBy: req.userId,
    });
    const updated = await cfg.snippets.setCurrentVersion(snip.id, newVer.id);
    reply.status(201).send({ snippet: updated, version: newVer });
  });

  // ── GET /v1/snippets ─────────────────────────────────────────────────
  app.get("/snippets", async () => {
    const rows = await cfg.snippets.list();
    return { snippets: rows };
  });

  // ── DELETE /v1/snippets/:id ──────────────────────────────────────────
  app.delete("/snippets/:id", async (req, reply) => {
    if (!(await cfg.auth.canManageSnippets(req.userId))) {
      throw new AuthForbiddenError("manage snippets");
    }
    const { id } = SnippetIdParamSchema.parse(req.params);
    const removed = await cfg.snippets.delete(id);
    if (!removed) throw new PlaceholderNotFoundError(id);
    reply.status(204).send();
  });
}

function parseJsonField(raw: string | undefined): unknown {
  if (!raw || raw.trim() === "") return {};
  return JSON.parse(raw);
}
