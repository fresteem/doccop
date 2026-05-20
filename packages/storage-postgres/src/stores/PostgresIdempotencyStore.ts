/**
 * Postgres reference impl of `IdempotencyStore`.
 *
 * `store` uses `INSERT … ON CONFLICT DO NOTHING` so the second writer
 * with the same (key, user_id) sees no row insert without throwing —
 * the server has already returned the cached document by the time we
 * reach this path. This avoids unique-violation races during high-
 * concurrency replays.
 *
 * `cleanupOlderThan` is a host concern (cron / pg_cron) but exposed
 * here as a convenience.
 */

import type { IdempotencyStore } from "@doccop/server/types";
import { and, eq, lt } from "drizzle-orm";
import type { Database } from "../db.js";
import { idempotency } from "../schema.js";

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Database) {}

  async lookup(key: string, userId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(idempotency)
      .where(and(eq(idempotency.key, key), eq(idempotency.userId, userId)))
      .limit(1);
    return rows[0]?.generatedDocumentId ?? null;
  }

  async store(key: string, userId: string, documentId: string): Promise<void> {
    await this.db
      .insert(idempotency)
      .values({ key, userId, generatedDocumentId: documentId })
      .onConflictDoNothing({ target: [idempotency.key, idempotency.userId] });
  }

  /**
   * Delete rows older than `olderThan`. Run from a host cron job
   * (typically once daily) to garbage-collect 24h-old keys.
   */
  async cleanupOlderThan(olderThan: Date): Promise<number> {
    const rows = await this.db
      .delete(idempotency)
      .where(lt(idempotency.createdAt, olderThan))
      .returning({ key: idempotency.key });
    return rows.length;
  }
}
