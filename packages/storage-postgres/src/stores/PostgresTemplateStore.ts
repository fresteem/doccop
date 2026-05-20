/**
 * Postgres reference impl of `TemplateStore`.
 *
 * Optimistic locking on `setCurrentVersion` is implemented by writing
 * `UPDATE … WHERE current_version_id = expected` and checking the
 * row count: a returned `null` means the precondition failed (the
 * row's pointer had already moved). The server layer maps that to
 * HTTP 409.
 */

import type { TemplateRecord, TemplateStore } from "@doccop/server/types";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../db.js";
import { templateRowToRecord } from "../row-mappers.js";
import { templates } from "../schema.js";

export class PostgresTemplateStore implements TemplateStore {
  constructor(private readonly db: Database) {}

  async create(
    input: Omit<TemplateRecord, "id" | "createdAt" | "updatedAt" | "currentVersionId">,
  ): Promise<TemplateRecord> {
    const [row] = await this.db
      .insert(templates)
      .values({
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        ownerId: input.ownerId,
        visibility: input.visibility,
        partyCount: input.partyCount,
      })
      .returning();
    if (!row) throw new Error("template insert returned no row");
    return templateRowToRecord(row);
  }

  async get(id: string): Promise<TemplateRecord | null> {
    const rows = await this.db.select().from(templates).where(eq(templates.id, id)).limit(1);
    return rows[0] ? templateRowToRecord(rows[0]) : null;
  }

  async listVisible(userId: string): Promise<TemplateRecord[]> {
    const rows = await this.db
      .select()
      .from(templates)
      .where(or(eq(templates.visibility, "global"), eq(templates.ownerId, userId)))
      .orderBy(sql`${templates.updatedAt} desc`);
    return rows.map(templateRowToRecord);
  }

  async setCurrentVersion(
    templateId: string,
    expectedPreviousId: string | null,
    newVersionId: string,
  ): Promise<TemplateRecord | null> {
    // The precondition compares against the row's current pointer. Use
    // `IS NULL`-aware predicate for the first-version case.
    const precondition =
      expectedPreviousId === null
        ? isNull(templates.currentVersionId)
        : eq(templates.currentVersionId, expectedPreviousId);
    const [row] = await this.db
      .update(templates)
      .set({ currentVersionId: newVersionId, updatedAt: new Date() })
      .where(and(eq(templates.id, templateId), precondition))
      .returning();
    return row ? templateRowToRecord(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db.delete(templates).where(eq(templates.id, id)).returning({
      id: templates.id,
    });
    return rows.length > 0;
  }
}
