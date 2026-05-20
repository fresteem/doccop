/**
 * Postgres reference impl of `DocumentStore`.
 */

import type { DocumentStore, GeneratedDocumentRecord } from "@doccop/server/types";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db.js";
import { documentRowToRecord } from "../row-mappers.js";
import { generatedDocuments } from "../schema.js";

export class PostgresDocumentStore implements DocumentStore {
  constructor(private readonly db: Database) {}

  async create(
    input: Omit<GeneratedDocumentRecord, "id" | "createdAt">,
  ): Promise<GeneratedDocumentRecord> {
    const [row] = await this.db
      .insert(generatedDocuments)
      .values({
        templateId: input.templateId,
        templateVersionId: input.templateVersionId,
        parties: input.parties as unknown,
        variablesSnapshot: input.variablesSnapshot as unknown,
        number: input.number,
        name: input.name,
        storagePath: input.storagePath,
        sizeBytes: input.sizeBytes,
        createdBy: input.createdBy,
      })
      .returning();
    if (!row) throw new Error("generated_document insert returned no row");
    return documentRowToRecord(row);
  }

  async get(id: string): Promise<GeneratedDocumentRecord | null> {
    const rows = await this.db
      .select()
      .from(generatedDocuments)
      .where(eq(generatedDocuments.id, id))
      .limit(1);
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async listByOwner(userId: string): Promise<GeneratedDocumentRecord[]> {
    const rows = await this.db
      .select()
      .from(generatedDocuments)
      .where(eq(generatedDocuments.createdBy, userId))
      .orderBy(sql`${generatedDocuments.createdAt} desc`);
    return rows.map(documentRowToRecord);
  }
}
