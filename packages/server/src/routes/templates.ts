/**
 * `/v1/templates` endpoints.
 *
 *   POST   /v1/templates                            upload .docx, create template + v1
 *   GET    /v1/templates                            list templates visible to user
 *   GET    /v1/templates/:id                        metadata
 *   GET    /v1/templates/:id/preview                HTML preview (current version)
 *   POST   /v1/templates/:id/placeholders           wrap a selection → new version
 *   DELETE /v1/templates/:id/placeholders/:tag      unwrap → new version
 */

import {
  AuthForbiddenError,
  InvalidPlaceholderTagError,
  PlaceholderNotFoundError,
  VersionConflictError,
  ensureParaIds,
  list,
  parse,
  preview,
  serialize,
  unwrap,
  wrap,
  wrapBlock,
} from "@doccop/core";
import type { FastifyInstance } from "fastify";
import type { DoccopServerConfig } from "../config.js";
import { fileFromMultipart } from "../helpers/multipart.js";
import {
  PlaceholderTagParamSchema,
  PlaceholderWrapSchema,
  TemplateIdParamSchema,
  TemplateUploadSchema,
} from "../schemas.js";

export function registerTemplateRoutes(app: FastifyInstance, cfg: DoccopServerConfig): void {
  // ── POST /v1/templates ───────────────────────────────────────────────
  app.post("/templates", async (req, reply) => {
    const file = await fileFromMultipart(req, cfg.maxUploadBytes ?? 10 * 1024 * 1024);
    const meta = TemplateUploadSchema.parse(parseJsonField(file.fields.meta));

    // Parse + normalise the docx upfront so we can persist a clean
    // version. Any malformed-docx / xxe / size error throws here and
    // the error handler maps it to 4xx.
    const archive = parse(
      file.bytes,
      cfg.maxUploadBytes !== undefined ? { maxBytes: cfg.maxUploadBytes } : {},
    );
    ensureParaIds(archive);
    const normalised = serialize(archive);
    const placeholders = list(archive);

    const storagePath = await cfg.storage.saveTemplate(normalised, req.userId);
    const tpl = await cfg.templates.create({
      name: meta.name,
      description: meta.description ?? null,
      categoryId: meta.categoryId ?? null,
      ownerId: req.userId,
      visibility: meta.visibility,
      partyCount: meta.partyCount,
    });
    const version = await cfg.templateVersions.create({
      templateId: tpl.id,
      versionNumber: 1,
      storagePath,
      placeholders,
      createdBy: req.userId,
      changeSummary: "initial upload",
    });
    const updated = await cfg.templates.setCurrentVersion(tpl.id, null, version.id);
    if (!updated) {
      // Should never happen — we just created the template.
      throw new VersionConflictError(tpl.id, "null", "concurrent-create");
    }
    reply.status(201).send({ template: updated, version });
  });

  // ── GET /v1/templates ────────────────────────────────────────────────
  app.get("/templates", async (req) => {
    const rows = await cfg.templates.listVisible(req.userId);
    return { templates: rows };
  });

  // ── GET /v1/templates/:id ───────────────────────────────────────────
  app.get("/templates/:id", async (req) => {
    const { id } = TemplateIdParamSchema.parse(req.params);
    const tpl = await cfg.templates.get(id);
    if (!tpl) throw new PlaceholderNotFoundError(id);
    if (!(await cfg.auth.canRenderTemplate(req.userId, id))) {
      throw new AuthForbiddenError(`view template ${id}`);
    }
    return { template: tpl };
  });

  // ── GET /v1/templates/:id/preview ───────────────────────────────────
  app.get("/templates/:id/preview", async (req) => {
    const { id } = TemplateIdParamSchema.parse(req.params);
    const tpl = await cfg.templates.get(id);
    if (!tpl) throw new PlaceholderNotFoundError(id);
    if (!(await cfg.auth.canRenderTemplate(req.userId, id))) {
      throw new AuthForbiddenError(`view template ${id}`);
    }
    if (!tpl.currentVersionId) {
      // Template exists but has no version yet — fresh upload race.
      return {
        html: '<div class="doccop-document"></div>',
        anchors: { paragraphs: [], blockSdts: [] },
      };
    }
    const ver = await cfg.templateVersions.get(tpl.currentVersionId);
    if (!ver) throw new PlaceholderNotFoundError(tpl.currentVersionId);
    const bytes = await cfg.storage.loadTemplate(ver.storagePath);
    const archive = parse(bytes);
    return preview(archive);
  });

  // ── POST /v1/templates/:id/placeholders ─────────────────────────────
  app.post("/templates/:id/placeholders", async (req, reply) => {
    const { id } = TemplateIdParamSchema.parse(req.params);
    const body = PlaceholderWrapSchema.parse(req.body);

    if (!(await cfg.auth.canEditTemplate(req.userId, id))) {
      throw new AuthForbiddenError(`edit template ${id}`);
    }

    const tpl = await cfg.templates.get(id);
    if (!tpl) throw new PlaceholderNotFoundError(id);
    if (!tpl.currentVersionId) throw new PlaceholderNotFoundError(`${id}/current-version`);

    const expected = body.expectedVersionId ?? tpl.currentVersionId;
    if (expected !== tpl.currentVersionId) {
      throw new VersionConflictError(id, expected, tpl.currentVersionId);
    }

    const currentVer = await cfg.templateVersions.get(tpl.currentVersionId);
    if (!currentVer) throw new PlaceholderNotFoundError(tpl.currentVersionId);

    const bytes = await cfg.storage.loadTemplate(currentVer.storagePath);
    const archive = parse(bytes);
    ensureParaIds(archive);

    // `location` (inline) and `blockRange` (block) are mutually exclusive.
    // Reject both-present early so the routing below has a clean two-way
    // choice. Reject both-absent in the final `else` so the response is
    // a 400 with the standard error envelope, not a generic Fastify 500.
    if (body.blockRange !== undefined && body.location !== undefined) {
      throw new InvalidPlaceholderTagError(
        body.placeholder.tag,
        "provide exactly one of `location` (inline) or `blockRange` (block)",
      );
    }

    let wrapped: typeof archive;
    if (body.blockRange !== undefined) {
      wrapped = wrapBlock(archive, body.blockRange, body.placeholder);
    } else if (body.location !== undefined) {
      wrapped = wrap(archive, body.location, body.placeholder);
    } else {
      throw new InvalidPlaceholderTagError(
        body.placeholder.tag,
        "provide exactly one of `location` (inline) or `blockRange` (block)",
      );
    }
    const newBytes = serialize(wrapped);
    const newPlaceholders = list(wrapped);

    const newPath = await cfg.storage.saveTemplate(newBytes, req.userId);
    const newVer = await cfg.templateVersions.create({
      templateId: id,
      versionNumber: currentVer.versionNumber + 1,
      storagePath: newPath,
      placeholders: newPlaceholders,
      createdBy: req.userId,
      changeSummary: body.changeSummary ?? `wrap ${body.placeholder.tag}`,
    });
    const updated = await cfg.templates.setCurrentVersion(id, expected, newVer.id);
    if (!updated) {
      throw new VersionConflictError(id, expected, "concurrent");
    }
    reply.status(201).send({ template: updated, version: newVer });
  });

  // ── DELETE /v1/templates/:id/placeholders/:tag ──────────────────────
  app.delete("/templates/:id/placeholders/:tag", async (req, reply) => {
    const { id, tag } = PlaceholderTagParamSchema.parse(req.params);

    if (!(await cfg.auth.canEditTemplate(req.userId, id))) {
      throw new AuthForbiddenError(`edit template ${id}`);
    }

    const tpl = await cfg.templates.get(id);
    if (!tpl?.currentVersionId) throw new PlaceholderNotFoundError(id);

    const currentVer = await cfg.templateVersions.get(tpl.currentVersionId);
    if (!currentVer) throw new PlaceholderNotFoundError(tpl.currentVersionId);

    const bytes = await cfg.storage.loadTemplate(currentVer.storagePath);
    const archive = parse(bytes);
    const unwrapped = unwrap(archive, tag);
    const newBytes = serialize(unwrapped);
    const newPath = await cfg.storage.saveTemplate(newBytes, req.userId);
    const newVer = await cfg.templateVersions.create({
      templateId: id,
      versionNumber: currentVer.versionNumber + 1,
      storagePath: newPath,
      placeholders: list(unwrapped),
      createdBy: req.userId,
      changeSummary: `unwrap ${tag}`,
    });
    const updated = await cfg.templates.setCurrentVersion(id, tpl.currentVersionId, newVer.id);
    if (!updated) {
      throw new VersionConflictError(id, tpl.currentVersionId, "concurrent");
    }
    reply.send({ template: updated, version: newVer });
  });
}

/** Parse a multipart text field as JSON. Empty fields return `{}`. */
function parseJsonField(raw: string | undefined): unknown {
  if (!raw || raw.trim() === "") return {};
  return JSON.parse(raw);
}
