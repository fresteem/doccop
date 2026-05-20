/**
 * Public type contracts for @doccop/core.
 *
 * Everything user-facing lives here. Implementation modules import these
 * via the package barrel `@doccop/core` or directly from `@doccop/core/types`.
 *
 * Naming convention: in the engine, variables are scoped by party
 * (`party_a`, `party_b`, …) and `system`. The host application maps these
 * neutral scopes onto its own concepts (e.g. fest-ops's adapter binds
 * `party_a` to an internal organization, `party_b` to an external one).
 */

// ─── Identity & context ─────────────────────────────────────────────────────

/**
 * Free-form identifier for a host application user. The engine never
 * interprets this — it only forwards it to adapters and stores it in audit
 * rows. Hosts may use UUIDs, emails, or any stable string.
 */
export type UserId = string;

/**
 * Identifier for an entity (organization, customer, etc.) referenced by a
 * party slot at render time. Opaque to the engine.
 */
export type EntityId = string;

/**
 * Logical kind of entity. The engine matches resolvers against this string,
 * so values are convention-only. Common: `"organization"`, `"person"`,
 * `"custom"`.
 */
export type EntityType = string;

/**
 * Subtype within an entity type — used to select the matching requisites
 * snippet. For organizations in Ukraine this would be the legal form code:
 * `"TOV"`, `"FOP"`, `"PP"`, `"PrAT"`, `"AT"`, `"DP"`, `"GO"`, `"OTHER"`.
 */
export type EntitySubtype = string;

/**
 * Scope of a variable in a template. The engine treats `party_a`, `party_b`,
 * `party_c` … as N-th party slots and `system` as render-time computed
 * values (date, contract number, etc.).
 *
 * `"bareKey"` (since 0.2.0-beta.1) is a synthetic scope used by `list()`
 * when surfacing bare-key SDTs from snippet documents — those tags have
 * no scope prefix in the OOXML, so a discriminant is provided here for
 * host UIs that want to filter on placeholder kind. `wrapBareKey`
 * creates such SDTs with `<w:tag w:val="key">` (no scope, no dot);
 * `RequisitesEngine.TagRewriter` rewrites them to scoped form at
 * render time based on the target party slot.
 */
export type VariableScope = `party_${string}` | "system" | "custom" | "bareKey";

/**
 * Reference to a party in a generation request — which entity fills the
 * `party_a` / `party_b` / … slot.
 */
export interface PartyRef {
  /** Role identifier: usually `"party_a"`, `"party_b"`, … */
  role: string;
  /** Logical entity type the resolver knows how to handle. */
  entityType: EntityType;
  /** Opaque entity identifier. */
  entityId: EntityId;
}

// ─── Resolved values ────────────────────────────────────────────────────────

/**
 * Result of resolving a single placeholder. Resolvers return one of three
 * shapes:
 *
 * - `text` — substitute as a plain text run (most common).
 * - `image` — substitute as a `<w:drawing>` (signatures, logos). Available
 *   from Wave 12+; in v1 resolvers should return `text` or `absent`.
 * - `absent` — no value available. In strict mode this fails the render;
 *   otherwise renders a placeholder marker.
 */
export type ResolvedValue =
  | { kind: "text"; value: string }
  | {
      kind: "image";
      bytes: Uint8Array;
      mimeType: "image/png" | "image/jpeg";
      widthPx?: number;
      heightPx?: number;
    }
  | { kind: "absent"; reason?: string };

/** Context handed to every resolver call. */
export interface ResolveContext {
  /** Who triggered the render. Resolvers may use this for ACL filtering. */
  userId: UserId;
  /**
   * The full parties map for the current generation, keyed by role.
   * A party-scoped resolver looks up its own role here to find its
   * `entityType`/`entityId`.
   */
  parties: Record<string, PartyRef | undefined>;
  /**
   * Generation-time metadata available to system resolvers.
   * `templateCategory` is set when the template has one; `documentNumber`
   * is set once the numbering service has allocated it.
   */
  meta: {
    templateId: string;
    templateVersionId: string;
    templateCategory: string | null;
    documentNumber: string | null;
    now: Date;
  };
}

// ─── Resolvers (adapter-implemented) ────────────────────────────────────────

/**
 * Resolves placeholder keys within a single scope. The engine selects the
 * resolver whose `scope` matches the placeholder's scope at render time.
 *
 * Hosts typically register one resolver per party slot (binding `party_a` to
 * their internal-org resolver, `party_b` to external) plus a `system`
 * resolver for `system.contract_number`, `system.today`, etc.
 */
export interface EntityResolver {
  /** Scope this resolver handles (e.g. `"party_a"`, `"system"`). */
  readonly scope: VariableScope;

  /**
   * Resolve a single key.
   *
   * @param key The bare placeholder key (without scope prefix).
   * @param ctx Generation context.
   * @returns A `ResolvedValue`. Resolvers should return `{kind:"absent"}`
   *          rather than throwing for missing data.
   */
  resolve(key: string, ctx: ResolveContext): Promise<ResolvedValue>;
}

/**
 * Provides per-subtype requisites snippets. The engine calls this when it
 * encounters an SDT with tag `requisites:<role>` in the master template.
 *
 * Snippets are themselves docx documents with bare-key placeholders
 * (no scope prefix); the engine binds them to the requesting party
 * context at injection time.
 */
export interface RequisitesResolver {
  /**
   * @returns the snippet for the given entity, or `null` if none is
   * registered. The engine treats `null` like an absent variable in
   * strict mode.
   */
  resolveSnippet(
    entityType: EntityType,
    entitySubtype: EntitySubtype,
  ): Promise<TemplateSnippet | null>;
}

// ─── Numbering & naming ─────────────────────────────────────────────────────

/** Inputs handed to the numbering allocator. */
export interface AllocateContext {
  userId: UserId;
  /** Category code for category-aware sequences (e.g. `"CONSULT"`). */
  templateCategory: string | null;
  /** Year component for year-resetting sequences. */
  year: number;
  /** Parties involved — some hosts gate numbering on which party is filed. */
  parties: PartyRef[];
}

/**
 * Allocates a unique document number. Reference implementations should be
 * atomic (advisory lock / RPC / sequence) — the engine relies on uniqueness
 * for backward navigation and audit.
 *
 * The fest-ops adapter binds this to the existing `next_contract_number`
 * RPC, preserving the `NNN-YYYY/CATEGORY` format used pre-doccop.
 */
export interface NumberingService {
  allocate(ctx: AllocateContext): Promise<string>;
}

/** Inputs handed to the document filename formatter. */
export interface NamingContext {
  /** The allocated document number, as produced by `NumberingService`. */
  number: string;
  /** Template metadata. */
  templateName: string;
  templateCategory: string | null;
  /** Parties, in order. */
  parties: PartyRef[];
  /** When the document is being generated. */
  now: Date;
}

/** Formats the final filename (without extension). Synchronous by design. */
export interface NamingService {
  format(ctx: NamingContext): string;
}

// ─── Storage ────────────────────────────────────────────────────────────────

/** Hint passed to `StorageAdapter.saveDocument` about the blob being saved. */
export interface SaveDocumentHint {
  contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  ownerId: UserId;
  /** Suggested filename for the underlying blob store, if relevant. */
  suggestedName?: string;
}

/**
 * Persistence boundary for raw bytes (templates, snippets, rendered docs).
 * Metadata (rows in tables) is handled by separate stores; this is the file
 * blob layer only.
 *
 * Implementations:
 *  - `@doccop/storage-postgres` ships a filesystem-backed reference impl.
 *  - The fest-ops adapter implements this against Supabase Storage.
 *  - Hosts may swap in S3, GCS, etc.
 */
export interface StorageAdapter {
  /** Stores a template `.docx` blob. Returns an opaque storage path. */
  saveTemplate(bytes: Uint8Array, ownerId: UserId): Promise<string>;
  /** Loads template bytes by storage path. */
  loadTemplate(path: string): Promise<Uint8Array>;

  /** Stores a generated document `.docx` blob. */
  saveDocument(bytes: Uint8Array, hint: SaveDocumentHint): Promise<string>;
  /** Loads document bytes by storage path. */
  loadDocument(path: string): Promise<Uint8Array>;

  /** Stores a requisites snippet `.docx` blob. */
  saveSnippet(bytes: Uint8Array, ownerId: UserId): Promise<string>;
  /** Loads snippet bytes by storage path. */
  loadSnippet(path: string): Promise<Uint8Array>;

  /** Returns a time-limited download URL (signed) for the given path. */
  signedUrl(path: string, expiresInSec: number): Promise<string>;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

/**
 * Adapter that bridges the host's authentication into the engine. Server
 * endpoints call these per request; library users may bypass this and pass
 * `userId` directly.
 */
export interface AuthAdapter {
  /**
   * Extract the user id from an incoming request. Return `null` to deny.
   * The `req` is opaque to the engine — Fastify/Express/Hono request types
   * can all be passed.
   */
  userIdFromRequest(req: unknown): Promise<UserId | null>;

  canEditTemplate(userId: UserId, templateId: string): Promise<boolean>;
  canRenderTemplate(userId: UserId, templateId: string): Promise<boolean>;
  canManageSnippets(userId: UserId): Promise<boolean>;
}

// ─── Domain entities (engine-internal) ──────────────────────────────────────

/** Catalog of supported placeholder data types for runtime validation. */
export type DataType =
  | "text"
  | "number"
  | "integer"
  | "date"
  | "boolean"
  | "edrpou"
  | "rnokpp"
  | "iban"
  | "email"
  | "phone";

/** A placeholder as it appears in a template version. */
export interface Placeholder {
  /** Full tag stored in the SDT, e.g. `"party_a.full_name"`. */
  tag: string;
  /** Display label shown to template editors. */
  alias: string;
  /** Decomposed scope and key for resolver routing. */
  scope: VariableScope;
  key: string;
  /** Expected data type — engine validates resolved values against this. */
  dataType: DataType;
  /**
   * `w14:paraId` of the paragraph that contains this SDT, or the first
   * paragraph if the SDT is block-level and spans many. Used for stable
   * positional anchoring.
   */
  paraId: string;
}

/** A parsed requisites snippet ready for injection. */
export interface TemplateSnippet {
  id: string;
  entityType: EntityType;
  entitySubtype: EntitySubtype;
  /** Raw docx bytes — engine parses on demand. */
  bytes: Uint8Array;
  /** Bare-key placeholders inside the snippet. */
  placeholders: Placeholder[];
}

/** Resource limits enforced by the core engine. */
export interface EngineLimits {
  /** Max accepted template `.docx` size in bytes. Default 10 MiB. */
  maxTemplateBytes: number;
  /** Max accepted snippet `.docx` size in bytes. Default 5 MiB. */
  maxSnippetBytes: number;
  /** Max number of placeholders per template. Default 500. */
  maxPlaceholders: number;
  /** Max render duration in milliseconds. Default 30000. */
  renderTimeoutMs: number;
}

/** Behavioural flags for the render pipeline. */
export interface RenderOptions {
  /**
   * Strict mode (default `true`). Missing resolver / type mismatch fails
   * the render. When `false`, missing values are substituted with a
   * `{missing: <tag>}` marker text and reported as warnings.
   */
  strict: boolean;
}

/** Non-fatal observation emitted alongside a successful render. */
export interface RenderWarning {
  kind: "missing_resolver" | "absent_value" | "type_mismatch" | "snippet_missing";
  tag: string;
  detail: string;
}

/** Result of a single render call. */
export interface RenderResult {
  /** Rendered `.docx` bytes. */
  docx: Uint8Array;
  /** Resolved variable values, keyed by full tag (`"party_a.full_name"`). */
  resolvedValues: Record<string, string>;
  /** Warnings collected during non-strict renders. */
  warnings: RenderWarning[];
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

// ─── Observability ──────────────────────────────────────────────────────────

/**
 * Structured logger contract injected by the host.
 *
 * The engine never imports a concrete logger. Hosts pass a pino/winston/
 * console-based implementation via `DocCopConfig.logger`; default is
 * `NoopLogger`.
 *
 * Levels follow the standard hierarchy (trace, debug, info, warn, error — increasing severity).
 * `fields` is an optional structured payload merged into the log record;
 * conventional keys: `tag`, `templateId`, `userId`, `durationMs`.
 *
 * The engine itself emits no log lines as of `0.1.0-alpha.1` — this
 * interface is shipped first so that adopters can wire their logger
 * before any behavioural logging lands in a follow-up release.
 */
export interface Logger {
  trace(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Logger that drops every call. Default when `DocCopConfig.logger` is
 * not set. Kept as an exported constant (not a class) so consumers can
 * pass it directly without `new`.
 */
export const NoopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── Engine surface (set in stone for v1) ───────────────────────────────────

/**
 * The aggregate engine configuration. Hosts construct this once at boot and
 * pass to `DocCop`. Wiring follows the constructor pattern (chosen over a
 * plugin registry because the dependency graph is fully known at startup).
 */
export interface DocCopConfig {
  storage: StorageAdapter;
  resolvers: EntityResolver[];
  requisitesResolver: RequisitesResolver;
  numbering: NumberingService;
  naming: NamingService;
  auth?: AuthAdapter;
  limits?: Partial<EngineLimits>;
  render?: Partial<RenderOptions>;
  /** Structured logger. Defaults to `NoopLogger`. */
  logger?: Logger;
}
