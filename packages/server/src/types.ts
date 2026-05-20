/**
 * Server-side store interfaces.
 *
 * `@doccop/core` defines `StorageAdapter` for raw blob persistence. The
 * server needs richer metadata operations (list templates, look up by
 * id, version history). Each host implements these against its own
 * database — the in-memory reference impls under `test/helpers` show
 * the contract in ~150 lines.
 *
 * Conventions:
 * - All ids are opaque strings (UUIDs in fest-ops; whatever the host
 *   prefers).
 * - All time values are ISO-8601 strings — callers handle parsing.
 * - List operations support owner filtering only; full-text / category
 *   search is host-implemented above the store interface.
 */

import type { DataType, Placeholder, StorageAdapter, UserId } from "@doccop/core";

/** A persisted template row. */
export interface TemplateRecord {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  ownerId: UserId;
  visibility: "private" | "global";
  currentVersionId: string | null;
  partyCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A persisted template-version row. */
export interface TemplateVersionRecord {
  id: string;
  templateId: string;
  versionNumber: number;
  storagePath: string;
  placeholders: Placeholder[];
  /** ISO timestamp. */
  createdAt: string;
  createdBy: UserId;
  changeSummary: string | null;
}

/** Snippet metadata. */
export interface SnippetRecord {
  id: string;
  entityType: string;
  entitySubtype: string;
  name: string;
  ownerId: UserId;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetVersionRecord {
  id: string;
  snippetId: string;
  versionNumber: number;
  storagePath: string;
  placeholders: Placeholder[];
  createdAt: string;
  createdBy: UserId;
}

/** Generated document audit row. */
export interface GeneratedDocumentRecord {
  id: string;
  templateId: string;
  templateVersionId: string;
  parties: Array<{
    role: string;
    entityType: string;
    entityId: string;
  }>;
  variablesSnapshot: Record<string, string>;
  number: string;
  name: string;
  storagePath: string;
  sizeBytes: number;
  createdAt: string;
  createdBy: UserId;
}

// ─── Stores ────────────────────────────────────────────────────────────────

export interface TemplateStore {
  create(
    record: Omit<TemplateRecord, "id" | "createdAt" | "updatedAt" | "currentVersionId">,
  ): Promise<TemplateRecord>;
  get(id: string): Promise<TemplateRecord | null>;
  /**
   * List templates visible to a user. Includes globals + the user's
   * own private ones. Order: most-recently-updated first.
   */
  listVisible(userId: UserId): Promise<TemplateRecord[]>;
  /**
   * Set `currentVersionId` only if it matches `expectedPreviousId`.
   * Returns the new record on success, `null` on conflict.
   * Implements optimistic locking against concurrent edits.
   */
  setCurrentVersion(
    templateId: string,
    expectedPreviousId: string | null,
    newVersionId: string,
  ): Promise<TemplateRecord | null>;
  delete(id: string): Promise<boolean>;
}

export interface TemplateVersionStore {
  create(record: Omit<TemplateVersionRecord, "id" | "createdAt">): Promise<TemplateVersionRecord>;
  get(id: string): Promise<TemplateVersionRecord | null>;
  listByTemplate(templateId: string): Promise<TemplateVersionRecord[]>;
}

export interface SnippetStore {
  upsert(
    record: Omit<SnippetRecord, "id" | "createdAt" | "updatedAt" | "currentVersionId">,
  ): Promise<SnippetRecord>;
  get(id: string): Promise<SnippetRecord | null>;
  findBySubtype(entityType: string, entitySubtype: string): Promise<SnippetRecord | null>;
  list(): Promise<SnippetRecord[]>;
  setCurrentVersion(snippetId: string, newVersionId: string): Promise<SnippetRecord | null>;
  delete(id: string): Promise<boolean>;
}

export interface SnippetVersionStore {
  create(record: Omit<SnippetVersionRecord, "id" | "createdAt">): Promise<SnippetVersionRecord>;
  get(id: string): Promise<SnippetVersionRecord | null>;
}

export interface DocumentStore {
  create(
    record: Omit<GeneratedDocumentRecord, "id" | "createdAt">,
  ): Promise<GeneratedDocumentRecord>;
  get(id: string): Promise<GeneratedDocumentRecord | null>;
  /** List documents created by a user, newest first. */
  listByOwner(userId: UserId): Promise<GeneratedDocumentRecord[]>;
}

/** Idempotency key storage. Keys live for 24h then expire. */
export interface IdempotencyStore {
  /**
   * Look up a (key, userId) pair. Returns the previously created
   * document id when known, else `null`.
   */
  lookup(key: string, userId: UserId): Promise<string | null>;
  /**
   * Record that `userId` used `key` to create `documentId`. Implementations
   * MUST be atomic — concurrent calls with the same (key,userId) must not
   * both succeed.
   */
  store(key: string, userId: UserId, documentId: string): Promise<void>;
}

// ─── Variable data types ───────────────────────────────────────────────────

/**
 * Mapping of placeholder tag → DataType. The server uses this to feed
 * `DocxRenderer.render` for runtime validation. Hosts typically derive
 * this from their `doccop_variables` table.
 */
export interface DataTypeRegistry {
  forTag(tag: string): Promise<DataType | null>;
  /** Pre-fetch all known tags as a Map — render pass uses this once. */
  snapshot(): Promise<ReadonlyMap<string, DataType>>;
}

// ─── Re-exported core types for convenience ────────────────────────────────

export type { StorageAdapter };
