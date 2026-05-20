/**
 * Mappers between Drizzle row shapes and the `@doccop/server` record
 * interfaces.
 *
 * Drizzle returns `Date` for timestamp columns; the server interfaces
 * spec ISO-8601 strings (so the wire format stays consistent across
 * adapter implementations). Mappers handle that conversion plus the
 * jsonb cast to the engine's typed structures.
 */

import type { Placeholder } from "@doccop/core";
import type {
  GeneratedDocumentRecord,
  SnippetRecord,
  SnippetVersionRecord,
  TemplateRecord,
  TemplateVersionRecord,
} from "@doccop/server/types";
import type {
  GeneratedDocumentRow,
  SnippetRow,
  SnippetVersionRow,
  TemplateRow,
  TemplateVersionRow,
} from "./schema.js";

const iso = (d: Date | string): string => (typeof d === "string" ? d : d.toISOString());

export function templateRowToRecord(r: TemplateRow): TemplateRecord {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    categoryId: r.categoryId,
    ownerId: r.ownerId,
    visibility: r.visibility,
    currentVersionId: r.currentVersionId,
    partyCount: r.partyCount,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function templateVersionRowToRecord(r: TemplateVersionRow): TemplateVersionRecord {
  return {
    id: r.id,
    templateId: r.templateId,
    versionNumber: r.versionNumber,
    storagePath: r.storagePath,
    placeholders: (r.placeholders ?? []) as Placeholder[],
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
    changeSummary: r.changeSummary,
  };
}

export function snippetRowToRecord(r: SnippetRow): SnippetRecord {
  return {
    id: r.id,
    entityType: r.entityType,
    entitySubtype: r.entitySubtype,
    name: r.name,
    ownerId: r.ownerId,
    currentVersionId: r.currentVersionId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function snippetVersionRowToRecord(r: SnippetVersionRow): SnippetVersionRecord {
  return {
    id: r.id,
    snippetId: r.snippetId,
    versionNumber: r.versionNumber,
    storagePath: r.storagePath,
    placeholders: (r.placeholders ?? []) as Placeholder[],
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
  };
}

export function documentRowToRecord(r: GeneratedDocumentRow): GeneratedDocumentRecord {
  return {
    id: r.id,
    templateId: r.templateId,
    templateVersionId: r.templateVersionId,
    parties: r.parties as GeneratedDocumentRecord["parties"],
    variablesSnapshot: (r.variablesSnapshot ?? {}) as Record<string, string>,
    number: r.number,
    name: r.name,
    storagePath: r.storagePath,
    sizeBytes: r.sizeBytes,
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
  };
}
