/**
 * Postgres reference impl of `TemplateVersionStore`.
 *
 * Version numbers are caller-supplied (the server increments based on
 * the current version's `versionNumber + 1`). The composite unique
 * index `(template_id, version_number)` prevents two concurrent edits
 * from producing colliding numbers — the second insert raises a
 * Postgres unique-violation, which the host should map back to a 409.
 */

import type { TemplateVersionRecord, TemplateVersionStore } from "@doccop/server/types";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db.js";
import { templateVersionRowToRecord } from "../row-mappers.js";
import { templateVersions } from "../schema.js";

export class PostgresTemplateVersionStore implements TemplateVersionStore {
  constructor(private readonly db: Database) {}

  async create(
    input: Omit<TemplateVersionRecord, "id" | "createdAt">,
  ): Promise<TemplateVersionRecord> {
    const [row] = await this.db
      .insert(templateVersions)
      .values({
        templateId: input.templateId,
        versionNumber: input.versionNumber,
        storagePath: input.storagePath,
        // The store stores arbitrary jsonb; Drizzle's jsonb accepts
        // anything assignable to its column type. Cast explicitly to
        // keep the public interface honest about the payload shape.
        placeholders: input.placeholders as unknown,
        createdBy: input.createdBy,
        changeSummary: input.changeSummary,
      })
      .returning();
    if (!row) throw new Error("template_version insert returned no row");
    return templateVersionRowToRecord(row);
  }

  async get(id: string): Promise<TemplateVersionRecord | null> {
    const rows = await this.db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.id, id))
      .limit(1);
    return rows[0] ? templateVersionRowToRecord(rows[0]) : null;
  }

  async listByTemplate(templateId: string): Promise<TemplateVersionRecord[]> {
    const rows = await this.db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, templateId))
      .orderBy(sql`${templateVersions.versionNumber} asc`);
    return rows.map(templateVersionRowToRecord);
  }
}
