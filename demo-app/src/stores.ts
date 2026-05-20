/**
 * In-memory implementations of every @doccop/server store interface
 * plus a memory-backed StorageAdapter. Adapted from
 * packages/server/test/helpers.ts — kept duplicated here on purpose so
 * the demo-app is self-contained reading material for new integrators.
 *
 * For production: swap each impl for its persistent counterpart
 * (PostgresTemplateStore, etc. from @doccop/storage-postgres) and the
 * filesystem/S3 blob storage of your choice.
 */

import { randomUUID } from "node:crypto";
import type { SaveDocumentHint, StorageAdapter, UserId } from "@doccop/core";
import type {
  DataTypeRegistry,
  DocumentStore,
  GeneratedDocumentRecord,
  IdempotencyStore,
  SnippetRecord,
  SnippetStore,
  SnippetVersionRecord,
  SnippetVersionStore,
  TemplateRecord,
  TemplateStore,
  TemplateVersionRecord,
  TemplateVersionStore,
} from "@doccop/server";

// ─── Blob storage ──────────────────────────────────────────────────────────

export class InMemoryStorage implements StorageAdapter {
  private blobs = new Map<string, Uint8Array>();

  async saveTemplate(bytes: Uint8Array, ownerId: UserId): Promise<string> {
    const path = `templates/${ownerId}/${randomUUID()}.docx`;
    this.blobs.set(path, bytes);
    return path;
  }
  async loadTemplate(path: string): Promise<Uint8Array> {
    const blob = this.blobs.get(path);
    if (!blob) throw new Error(`no blob at ${path}`);
    return blob;
  }
  async saveDocument(bytes: Uint8Array, hint: SaveDocumentHint): Promise<string> {
    const path = `documents/${hint.ownerId}/${randomUUID()}.docx`;
    this.blobs.set(path, bytes);
    return path;
  }
  async loadDocument(path: string): Promise<Uint8Array> {
    const blob = this.blobs.get(path);
    if (!blob) throw new Error(`no blob at ${path}`);
    return blob;
  }
  async saveSnippet(bytes: Uint8Array, ownerId: UserId): Promise<string> {
    const path = `snippets/${ownerId}/${randomUUID()}.docx`;
    this.blobs.set(path, bytes);
    return path;
  }
  async loadSnippet(path: string): Promise<Uint8Array> {
    const blob = this.blobs.get(path);
    if (!blob) throw new Error(`no blob at ${path}`);
    return blob;
  }
  async signedUrl(path: string): Promise<string> {
    return `memory://${path}`;
  }
}

// ─── Metadata stores ───────────────────────────────────────────────────────

export class InMemoryTemplateStore implements TemplateStore {
  private rows = new Map<string, TemplateRecord>();

  async create(input: Omit<TemplateRecord, "id" | "createdAt" | "updatedAt" | "currentVersionId">) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const row: TemplateRecord = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
      currentVersionId: null,
    };
    this.rows.set(id, row);
    return row;
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listVisible(userId: UserId) {
    return [...this.rows.values()].filter((r) => r.visibility === "global" || r.ownerId === userId);
  }
  async setCurrentVersion(id: string, expected: string | null, next: string) {
    const row = this.rows.get(id);
    if (!row) return null;
    if (row.currentVersionId !== expected) return null;
    const updated: TemplateRecord = {
      ...row,
      currentVersionId: next,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, updated);
    return updated;
  }
  async delete(id: string) {
    return this.rows.delete(id);
  }
}

export class InMemoryTemplateVersionStore implements TemplateVersionStore {
  private rows = new Map<string, TemplateVersionRecord>();

  async create(input: Omit<TemplateVersionRecord, "id" | "createdAt">) {
    const id = randomUUID();
    const row: TemplateVersionRecord = { ...input, id, createdAt: new Date().toISOString() };
    this.rows.set(id, row);
    return row;
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listByTemplate(templateId: string) {
    return [...this.rows.values()].filter((r) => r.templateId === templateId);
  }
}

export class InMemorySnippetStore implements SnippetStore {
  private rows = new Map<string, SnippetRecord>();

  async upsert(input: Omit<SnippetRecord, "id" | "createdAt" | "updatedAt" | "currentVersionId">) {
    const existing = [...this.rows.values()].find(
      (r) => r.entityType === input.entityType && r.entitySubtype === input.entitySubtype,
    );
    if (existing) {
      const updated: SnippetRecord = {
        ...existing,
        name: input.name,
        updatedAt: new Date().toISOString(),
      };
      this.rows.set(existing.id, updated);
      return updated;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const row: SnippetRecord = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
      currentVersionId: null,
    };
    this.rows.set(id, row);
    return row;
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findBySubtype(entityType: string, entitySubtype: string) {
    return (
      [...this.rows.values()].find(
        (r) => r.entityType === entityType && r.entitySubtype === entitySubtype,
      ) ?? null
    );
  }
  async list() {
    return [...this.rows.values()];
  }
  async setCurrentVersion(id: string, versionId: string) {
    const row = this.rows.get(id);
    if (!row) return null;
    const updated: SnippetRecord = {
      ...row,
      currentVersionId: versionId,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, updated);
    return updated;
  }
  async delete(id: string) {
    return this.rows.delete(id);
  }
}

export class InMemorySnippetVersionStore implements SnippetVersionStore {
  private rows = new Map<string, SnippetVersionRecord>();

  async create(input: Omit<SnippetVersionRecord, "id" | "createdAt">) {
    const id = randomUUID();
    const row: SnippetVersionRecord = { ...input, id, createdAt: new Date().toISOString() };
    this.rows.set(id, row);
    return row;
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
}

export class InMemoryDocumentStore implements DocumentStore {
  private rows = new Map<string, GeneratedDocumentRecord>();

  async create(input: Omit<GeneratedDocumentRecord, "id" | "createdAt">) {
    const id = randomUUID();
    const row: GeneratedDocumentRecord = { ...input, id, createdAt: new Date().toISOString() };
    this.rows.set(id, row);
    return row;
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listByOwner(userId: UserId) {
    return [...this.rows.values()].filter((r) => r.createdBy === userId);
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  // Composite key (userId, requestKey) -> documentId. Using a Map of
  // strings keeps the demo dependency-free; production hosts use a DB
  // table with an atomic ON CONFLICT DO NOTHING.
  private rows = new Map<string, string>();
  private compositeKey(key: string, userId: UserId): string {
    return `${userId}::${key}`;
  }
  async lookup(key: string, userId: UserId) {
    return this.rows.get(this.compositeKey(key, userId)) ?? null;
  }
  async store(key: string, userId: UserId, documentId: string) {
    const k = this.compositeKey(key, userId);
    if (!this.rows.has(k)) this.rows.set(k, documentId);
  }
}

export class InMemoryDataTypes implements DataTypeRegistry {
  constructor(private readonly types: Map<string, import("@doccop/core").DataType> = new Map()) {}
  async forTag(tag: string) {
    return this.types.get(tag) ?? null;
  }
  async snapshot() {
    return new Map(this.types);
  }
}

// ─── Bundle factory ────────────────────────────────────────────────────────

/**
 * Build a fresh set of in-memory stores. Convenient for boot
 * scripts and tests — pass the returned object's fields directly into
 * `DoccopServerConfig`.
 */
export function buildInMemoryStores() {
  return {
    storage: new InMemoryStorage(),
    templates: new InMemoryTemplateStore(),
    templateVersions: new InMemoryTemplateVersionStore(),
    snippets: new InMemorySnippetStore(),
    snippetVersions: new InMemorySnippetVersionStore(),
    documents: new InMemoryDocumentStore(),
    idempotency: new InMemoryIdempotencyStore(),
    dataTypes: new InMemoryDataTypes(
      new Map<string, import("@doccop/core").DataType>([
        ["party_a.full_name", "text"],
        ["party_a.edrpou", "edrpou"],
        ["party_a.iban", "iban"],
        ["party_b.full_name", "text"],
        ["party_b.edrpou", "edrpou"],
        ["system.today", "date"],
        ["system.contract_number", "text"],
      ]),
    ),
  };
}
