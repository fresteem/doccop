/**
 * In-memory reference impls of the server stores + test rig.
 *
 * Each test builds its own server with `buildTestServer()`, gets back
 * a Fastify instance ready for `inject()` calls, plus the in-memory
 * stores so assertions can inspect what got persisted.
 */

import { randomUUID } from "node:crypto";
import type {
  AllocateContext,
  AuthAdapter,
  DataType,
  EntityResolver,
  NamingContext,
  NamingService,
  NumberingService,
  Placeholder,
  RequisitesResolver,
  SaveDocumentHint,
  StorageAdapter,
  UserId,
} from "@doccop/core";
import fastifyMultipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { type DoccopServerConfig, doccopRoutes } from "../src/index.js";
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
} from "../src/types.js";

// ─── Stores ─────────────────────────────────────────────────────────────

export class InMemoryStorage implements StorageAdapter {
  private blobs = new Map<string, Uint8Array>();
  async saveTemplate(bytes: Uint8Array, ownerId: UserId): Promise<string> {
    const path = `templates/${ownerId}/${randomUUID()}.docx`;
    this.blobs.set(path, bytes);
    return path;
  }
  async loadTemplate(path: string): Promise<Uint8Array> {
    const b = this.blobs.get(path);
    if (!b) throw new Error(`no blob at ${path}`);
    return b;
  }
  async saveDocument(bytes: Uint8Array, hint: SaveDocumentHint): Promise<string> {
    const path = `documents/${hint.ownerId}/${randomUUID()}.docx`;
    this.blobs.set(path, bytes);
    return path;
  }
  async loadDocument(path: string): Promise<Uint8Array> {
    const b = this.blobs.get(path);
    if (!b) throw new Error(`no blob at ${path}`);
    return b;
  }
  async saveSnippet(bytes: Uint8Array, ownerId: UserId): Promise<string> {
    const path = `snippets/${ownerId}/${randomUUID()}.docx`;
    this.blobs.set(path, bytes);
    return path;
  }
  async loadSnippet(path: string): Promise<Uint8Array> {
    const b = this.blobs.get(path);
    if (!b) throw new Error(`no blob at ${path}`);
    return b;
  }
  async signedUrl(path: string): Promise<string> {
    return `memory://${path}`;
  }
}

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
  private rows = new Map<string, string>();
  async lookup(key: string, userId: UserId) {
    return this.rows.get(`${userId}:${key}`) ?? null;
  }
  async store(key: string, userId: UserId, docId: string) {
    this.rows.set(`${userId}:${key}`, docId);
  }
}

export class InMemoryDataTypes implements DataTypeRegistry {
  constructor(private types: Map<string, DataType> = new Map()) {}
  async forTag(tag: string) {
    return this.types.get(tag) ?? null;
  }
  async snapshot() {
    return new Map(this.types);
  }
}

// ─── Pluggable adapters ─────────────────────────────────────────────────

export class TestAuth implements AuthAdapter {
  constructor(
    public allowedUsers: Set<UserId> = new Set(["user-1"]),
    public manageSnippetsUsers: Set<UserId> = new Set(["user-1"]),
  ) {}
  async userIdFromRequest(req: unknown) {
    const headers = (req as { headers?: Record<string, string> }).headers ?? {};
    const candidate = headers["x-user-id"];
    if (candidate && this.allowedUsers.has(candidate)) return candidate;
    return null;
  }
  async canEditTemplate() {
    return true;
  }
  async canRenderTemplate() {
    return true;
  }
  async canManageSnippets(userId: UserId) {
    return this.manageSnippetsUsers.has(userId);
  }
}

export const staticResolver = (
  scope: EntityResolver["scope"],
  values: Record<string, string>,
): EntityResolver => ({
  scope,
  async resolve(key) {
    if (key in values) return { kind: "text", value: values[key] as string };
    return { kind: "absent", reason: `no key '${key}'` };
  },
});

export const staticRequisitesResolver = (
  bytes: Uint8Array,
  entityType: string,
  entitySubtype: string,
): RequisitesResolver => ({
  async resolveSnippet(t, s) {
    if (t === entityType && s === entitySubtype) {
      return {
        id: "snippet-static",
        entityType,
        entitySubtype,
        bytes,
        placeholders: [] as Placeholder[],
      };
    }
    return null;
  },
});

export const fixedNumberingService = (n: string): NumberingService => ({
  async allocate(_ctx: AllocateContext) {
    return n;
  },
});

export const slashNamingService: NamingService = {
  format(ctx: NamingContext) {
    return ctx.number.replace(/\//g, "_");
  },
};

// ─── Server factory ─────────────────────────────────────────────────────

export interface TestRig {
  app: FastifyInstance;
  cfg: DoccopServerConfig;
  storage: InMemoryStorage;
  templates: InMemoryTemplateStore;
  templateVersions: InMemoryTemplateVersionStore;
  snippets: InMemorySnippetStore;
  snippetVersions: InMemorySnippetVersionStore;
  documents: InMemoryDocumentStore;
  idempotency: InMemoryIdempotencyStore;
  dataTypes: InMemoryDataTypes;
  auth: TestAuth;
}

export async function buildTestServer(
  overrides: Partial<DoccopServerConfig> = {},
): Promise<TestRig> {
  const storage = new InMemoryStorage();
  const templates = new InMemoryTemplateStore();
  const templateVersions = new InMemoryTemplateVersionStore();
  const snippets = new InMemorySnippetStore();
  const snippetVersions = new InMemorySnippetVersionStore();
  const documents = new InMemoryDocumentStore();
  const idempotency = new InMemoryIdempotencyStore();
  const dataTypes = new InMemoryDataTypes();
  const auth = new TestAuth();

  const cfg: DoccopServerConfig = {
    storage,
    templates,
    templateVersions,
    snippets,
    snippetVersions,
    documents,
    idempotency,
    dataTypes,
    resolvers: [staticResolver("party_a", { full_name: "Internal", subtype: "TOV" })],
    numbering: fixedNumberingService("001-2026/TEST"),
    naming: slashNamingService,
    auth,
    ...overrides,
  };

  const app = Fastify({ logger: false });
  await app.register(fastifyMultipart, {
    limits: { fileSize: cfg.maxUploadBytes ?? 10 * 1024 * 1024 },
  });
  await app.register(doccopRoutes, { config: cfg });
  await app.ready();

  return {
    app,
    cfg,
    storage,
    templates,
    templateVersions,
    snippets,
    snippetVersions,
    documents,
    idempotency,
    dataTypes,
    auth,
  };
}

// ─── Docx fixture builders (re-export from core's test fixtures) ────────

// We can't import from core's test/ tree (separate compile unit) so we
// build minimal valid docx via PizZip here. Mirrors core's fixtureBuilder
// but pared down to what server tests need.
import PizZip from "pizzip";

export function tinyDocxBytes(text = "Hello"): Uint8Array {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="AAAA0001"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  return zip.generate({ type: "uint8array" });
}
