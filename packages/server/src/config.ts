/**
 * Aggregated configuration for the doccop Fastify plugin.
 *
 * Hosts assemble this once at boot time, then register the plugin:
 *
 *   const app = fastify();
 *   await app.register(doccopRoutes, { config });
 *
 * The plugin attaches all `/v1/*` routes under whatever prefix the
 * caller chose (`{ prefix: "/api" }` to mount under `/api/v1/*`).
 */

import type {
  AuthAdapter,
  EntityResolver,
  NamingService,
  NumberingService,
  RequisitesResolver,
} from "@doccop/core";
import type {
  DataTypeRegistry,
  DocumentStore,
  IdempotencyStore,
  SnippetStore,
  SnippetVersionStore,
  StorageAdapter,
  TemplateStore,
  TemplateVersionStore,
} from "./types.js";

export interface DoccopServerConfig {
  // ─── Storage layer ─────────────────────────────────────────────────────
  storage: StorageAdapter;
  templates: TemplateStore;
  templateVersions: TemplateVersionStore;
  snippets: SnippetStore;
  snippetVersions: SnippetVersionStore;
  documents: DocumentStore;
  idempotency: IdempotencyStore;
  dataTypes: DataTypeRegistry;

  // ─── Engine wiring ─────────────────────────────────────────────────────
  resolvers: EntityResolver[];
  requisitesResolver?: RequisitesResolver;
  numbering: NumberingService;
  naming: NamingService;
  auth: AuthAdapter;

  // ─── Limits ────────────────────────────────────────────────────────────
  /** Max accepted .docx upload size in bytes. Default 10 MiB. */
  maxUploadBytes?: number;
  /** Concurrent renders allowed per user. Default 5. */
  maxConcurrentRendersPerUser?: number;
  /** Render requests per minute per user. Default 60. */
  rateLimitPerMinute?: number;
  /** Strict-mode flag for renders (default true). Per-request override is also
   *  available via the request body. */
  strictRender?: boolean;
}

/** Apply config defaults. Pure — no I/O. */
export function withDefaults(
  c: DoccopServerConfig,
): Required<
  Omit<
    DoccopServerConfig,
    | "storage"
    | "templates"
    | "templateVersions"
    | "snippets"
    | "snippetVersions"
    | "documents"
    | "idempotency"
    | "dataTypes"
    | "resolvers"
    | "requisitesResolver"
    | "numbering"
    | "naming"
    | "auth"
  >
> &
  DoccopServerConfig {
  return {
    ...c,
    maxUploadBytes: c.maxUploadBytes ?? 10 * 1024 * 1024,
    maxConcurrentRendersPerUser: c.maxConcurrentRendersPerUser ?? 5,
    rateLimitPerMinute: c.rateLimitPerMinute ?? 60,
    strictRender: c.strictRender ?? true,
  };
}
