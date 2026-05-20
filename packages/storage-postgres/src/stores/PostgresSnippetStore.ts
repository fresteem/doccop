/**
 * Postgres reference impl of `SnippetStore`.
 *
 * `upsert` uses Postgres's `ON CONFLICT … DO UPDATE` keyed on
 * (entity_type, entity_subtype) — the natural key for per-subtype
 * snippets. This lets administrators "replace the TOV snippet" with a
 * single endpoint call rather than first deleting and recreating.
 */

import type { SnippetRecord, SnippetStore } from "@doccop/server/types";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db.js";
import { snippetRowToRecord } from "../row-mappers.js";
import { snippets } from "../schema.js";

export class PostgresSnippetStore implements SnippetStore {
  constructor(private readonly db: Database) {}

  async upsert(
    input: Omit<SnippetRecord, "id" | "createdAt" | "updatedAt" | "currentVersionId">,
  ): Promise<SnippetRecord> {
    const [row] = await this.db
      .insert(snippets)
      .values({
        entityType: input.entityType,
        entitySubtype: input.entitySubtype,
        name: input.name,
        ownerId: input.ownerId,
      })
      .onConflictDoUpdate({
        target: [snippets.entityType, snippets.entitySubtype],
        set: { name: input.name, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("snippet upsert returned no row");
    return snippetRowToRecord(row);
  }

  async get(id: string): Promise<SnippetRecord | null> {
    const rows = await this.db.select().from(snippets).where(eq(snippets.id, id)).limit(1);
    return rows[0] ? snippetRowToRecord(rows[0]) : null;
  }

  async findBySubtype(entityType: string, entitySubtype: string): Promise<SnippetRecord | null> {
    const rows = await this.db
      .select()
      .from(snippets)
      .where(and(eq(snippets.entityType, entityType), eq(snippets.entitySubtype, entitySubtype)))
      .limit(1);
    return rows[0] ? snippetRowToRecord(rows[0]) : null;
  }

  async list(): Promise<SnippetRecord[]> {
    const rows = await this.db
      .select()
      .from(snippets)
      .orderBy(sql`${snippets.entityType}, ${snippets.entitySubtype}`);
    return rows.map(snippetRowToRecord);
  }

  async setCurrentVersion(snippetId: string, newVersionId: string): Promise<SnippetRecord | null> {
    const [row] = await this.db
      .update(snippets)
      .set({ currentVersionId: newVersionId, updatedAt: new Date() })
      .where(eq(snippets.id, snippetId))
      .returning();
    return row ? snippetRowToRecord(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db.delete(snippets).where(eq(snippets.id, id)).returning({
      id: snippets.id,
    });
    return rows.length > 0;
  }
}
