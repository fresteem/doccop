/**
 * Postgres reference impl of `SnippetVersionStore`.
 */

import type { SnippetVersionRecord, SnippetVersionStore } from "@doccop/server/types";
import { eq } from "drizzle-orm";
import type { Database } from "../db.js";
import { snippetVersionRowToRecord } from "../row-mappers.js";
import { snippetVersions } from "../schema.js";

export class PostgresSnippetVersionStore implements SnippetVersionStore {
  constructor(private readonly db: Database) {}

  async create(
    input: Omit<SnippetVersionRecord, "id" | "createdAt">,
  ): Promise<SnippetVersionRecord> {
    const [row] = await this.db
      .insert(snippetVersions)
      .values({
        snippetId: input.snippetId,
        versionNumber: input.versionNumber,
        storagePath: input.storagePath,
        placeholders: input.placeholders as unknown,
        createdBy: input.createdBy,
      })
      .returning();
    if (!row) throw new Error("snippet_version insert returned no row");
    return snippetVersionRowToRecord(row);
  }

  async get(id: string): Promise<SnippetVersionRecord | null> {
    const rows = await this.db
      .select()
      .from(snippetVersions)
      .where(eq(snippetVersions.id, id))
      .limit(1);
    return rows[0] ? snippetVersionRowToRecord(rows[0]) : null;
  }
}
