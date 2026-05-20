# Integration guide

How to embed doccop into a host application. Pick your integration shape, then implement the adapter interfaces shown below. Working reference implementations live in `packages/server/test/helpers.ts` (in-memory, ~250 LoC) and `packages/storage-postgres/src/stores/*` (Drizzle-backed, production-grade).

## Pick an integration shape

| Shape | When to use | What you write |
|---|---|---|
| **HTTP-only** | Sidecar deployment, host in another language, microservices boundary | A Fastify process that registers `@doccop/server` with your stores/resolvers; nothing else |
| **In-process** | Existing Node host with Fastify | Register `doccopRoutes` as a plugin on your existing Fastify app — shares auth, logging, observability |
| **Library-only** | Workers, CLIs, batch jobs, non-HTTP hosts | Call `@doccop/core` functions directly, persist what you like |

## Adapter checklist

The host implements these. Pre-1.0 the interfaces are frozen for any non-major release — see [`AGENTS.md`](../AGENTS.md#public-api-surface-is-frozen-until-v10).

### `StorageAdapter` (core)

Stores raw bytes — templates, snippets, generated documents. Opaque paths; the host chooses path structure.

```typescript
import type { StorageAdapter, UserId } from "@doccop/core";

class S3StorageAdapter implements StorageAdapter {
  async saveTemplate(bytes: Uint8Array, ownerId: UserId): Promise<string> {
    const key = `templates/${ownerId}/${crypto.randomUUID()}.docx`;
    await s3.putObject({ Bucket: "doccop", Key: key, Body: bytes });
    return key;
  }
  async loadTemplate(path: string): Promise<Uint8Array> {
    const res = await s3.getObject({ Bucket: "doccop", Key: path });
    return new Uint8Array(await res.Body!.transformToByteArray());
  }
  // saveDocument / loadDocument / saveSnippet / loadSnippet / signedUrl — same shape
}
```

**Reference impl:** [`FilesystemBlobStorage`](../packages/storage-postgres/src/FilesystemBlobStorage.ts) — disk-backed, includes path-traversal defences and `StorageFailedError` wrapping.

### `EntityResolver[]` (core)

One resolver per scope. The engine picks the matching resolver at render time by `placeholder.scope === resolver.scope`.

```typescript
import type { EntityResolver, ResolveContext, ResolvedValue } from "@doccop/core";

class OrganizationsResolver implements EntityResolver {
  readonly scope = "party_a";  // or "party_b", etc.
  constructor(private db: Db) {}

  async resolve(key: string, ctx: ResolveContext): Promise<ResolvedValue> {
    const partyRef = ctx.parties[this.scope];
    if (!partyRef) return { kind: "absent", reason: "no party_a in request" };
    const org = await this.db.findOrganization(partyRef.entityId);
    if (!org) return { kind: "absent", reason: `org ${partyRef.entityId} not found` };

    switch (key) {
      case "full_name": return { kind: "text", value: org.fullName };
      case "edrpou":    return { kind: "text", value: org.taxId };
      case "subtype":   return { kind: "text", value: org.legalForm }; // for requisites lookup
      default:          return { kind: "absent", reason: `unknown key ${key}` };
    }
  }
}
```

**Conventions:**
- Return `{ kind: "absent" }` for missing data — do not throw. The engine maps absent→`AbsentValueInStrictModeError` (strict) or a warning (non-strict).
- Throwing is reserved for *unexpected* failures (DB down, etc.) — they bubble as `ResolverFailedError` → HTTP 502 in `@doccop/server`.
- ACL filtering: use `ctx.userId` to enforce per-user data visibility.
- `subtype` is a convention key — the `RequisitesResolver` consults it to pick the right snippet (Ukrainian legal forms: TOV / FOP / PP / …).

### `RequisitesResolver` (core)

Looks up a snippet for `(entityType, entitySubtype)`. Called by `RequisitesEngine` when expanding `requisites:party_X` block SDTs.

```typescript
import type { RequisitesResolver, TemplateSnippet } from "@doccop/core";

class SnippetResolver implements RequisitesResolver {
  constructor(private snippetStore: SnippetStore, private storage: StorageAdapter) {}

  async resolveSnippet(entityType: string, entitySubtype: string): Promise<TemplateSnippet | null> {
    const rec = await this.snippetStore.findBySubtype(entityType, entitySubtype);
    if (!rec?.currentVersionId) return null;
    const ver = await this.snippetVersionStore.get(rec.currentVersionId);
    if (!ver) return null;
    const bytes = await this.storage.loadSnippet(ver.storagePath);
    return { id: rec.id, entityType, entitySubtype, bytes, placeholders: ver.placeholders };
  }
}
```

**Cache aggressively** — the same snippet may be loaded for every render. Per-process LRU keyed by `${entityType}:${entitySubtype}` is appropriate.

### `NumberingService` + `NamingService` (core)

Allocate document numbers atomically and format filenames. The engine relies on `NumberingService.allocate` being atomic — concurrent renders must never receive the same number.

```typescript
import type { NumberingService, AllocateContext } from "@doccop/core";

class PostgresNumberingService implements NumberingService {
  constructor(private sql: Sql) {}
  async allocate(ctx: AllocateContext): Promise<string> {
    // Use an advisory lock or RPC. Naive sequence is fine until you have
    // category-aware counters.
    const rows = await this.sql`SELECT next_contract_number(${ctx.templateCategory ?? null}, ${ctx.year}) AS num`;
    return rows[0].num;
  }
}
```

For `NamingService.format(ctx)` return the filename **without extension** — the engine appends `.docx`.

### `AuthAdapter` (core, used by `@doccop/server`)

Bridges the host's auth into the engine. The Fastify plugin calls these per request.

```typescript
import type { AuthAdapter, UserId } from "@doccop/core";

class JwtAuthAdapter implements AuthAdapter {
  async userIdFromRequest(req: unknown): Promise<UserId | null> {
    const token = (req as FastifyRequest).headers.authorization?.replace(/^Bearer /, "");
    return token ? await verifyJwt(token) : null;
  }
  async canEditTemplate(userId: UserId, templateId: string): Promise<boolean> { /* ... */ }
  async canRenderTemplate(userId: UserId, templateId: string): Promise<boolean> { /* ... */ }
  async canManageSnippets(userId: UserId): Promise<boolean> { /* ... */ }
}
```

### Server stores (`@doccop/server`)

Seven interfaces in [`packages/server/src/types.ts`](../packages/server/src/types.ts):

| Interface | What |
|---|---|
| `TemplateStore` | CRUD on template metadata. `setCurrentVersion(id, expectedPrev, new)` MUST be atomic — returns `null` on optimistic-lock conflict. |
| `TemplateVersionStore` | Immutable version rows. `create` returns the persisted record with `id` + `createdAt`. |
| `SnippetStore` | Upsert by `(entityType, entitySubtype)`. |
| `SnippetVersionStore` | Immutable snippet version rows. |
| `DocumentStore` | Audit log of every rendered document, with `parties` + `variablesSnapshot`. |
| `IdempotencyStore` | `(key, userId)` → `documentId`. `store` MUST be atomic — concurrent calls with the same `(key,userId)` must not both succeed. Use `ON CONFLICT DO NOTHING`. |
| `DataTypeRegistry` | Maps placeholder tag → `DataType` for runtime validation. `snapshot()` is the fast path used per-render. |

**Reference impls:**
- In-memory, full feature: [`packages/server/test/helpers.ts`](../packages/server/test/helpers.ts) — copy this when bootstrapping a new host backend, then port the table accesses to your DB.
- Postgres + Drizzle: [`packages/storage-postgres/src/stores/`](../packages/storage-postgres/src/stores/) — production-grade, used by the demo app.

### `Logger` (optional, core, since `0.2.0-alpha.0`)

Inject a structured logger via `DocCopConfig.logger`. Default is `NoopLogger`.

```typescript
import type { Logger } from "@doccop/core";
import pino from "pino";

const pinoInstance = pino();
const logger: Logger = {
  trace: (msg, fields) => pinoInstance.trace(fields ?? {}, msg),
  debug: (msg, fields) => pinoInstance.debug(fields ?? {}, msg),
  info:  (msg, fields) => pinoInstance.info(fields ?? {}, msg),
  warn:  (msg, fields) => pinoInstance.warn(fields ?? {}, msg),
  error: (msg, fields) => pinoInstance.error(fields ?? {}, msg),
};
```

The engine emits no log lines yet (the contract is in place, behavioural integration lands in a follow-up release).

## HTTP-only integration

```typescript
import fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { doccopRoutes } from "@doccop/server";

const app = fastify();
await app.register(fastifyMultipart);
await app.register(doccopRoutes, {
  config: {
    storage: new S3StorageAdapter(),
    resolvers: [partyA, partyB, systemResolver],
    requisitesResolver: new SnippetResolver(snippetStore, storage),
    numbering: new PostgresNumberingService(sql),
    naming: { format: (ctx) => `${ctx.number} ${ctx.templateName}` },
    auth: new JwtAuthAdapter(),
    templates: new PostgresTemplateStore(db),
    templateVersions: new PostgresTemplateVersionStore(db),
    snippets: new PostgresSnippetStore(db),
    snippetVersions: new PostgresSnippetVersionStore(db),
    documents: new PostgresDocumentStore(db),
    idempotency: new PostgresIdempotencyStore(db),
    dataTypes: new PostgresDataTypeRegistry(db),
    logger,
  },
});
await app.listen({ port: 3000 });
```

This exposes `/v1/templates`, `/v1/snippets`, `/v1/documents` under the default prefix. To mount under your own path, wrap the plugin:

```typescript
await app.register(async (scope) => {
  await scope.register(doccopRoutes, { config });
}, { prefix: "/api" });
```

## Error handling

| `DocCopErrorCode` | HTTP status | Notes |
|---|---|---|
| `MALFORMED_DOCX` | 400 | Upload not a valid .docx ZIP |
| `TEMPLATE_TOO_LARGE`, `SNIPPET_TOO_LARGE` | 413 | Exceeds configured limit |
| `TOO_MANY_PLACEHOLDERS` | 422 | Template exceeds `maxPlaceholders` |
| `XXE_DETECTED` | 400 | Document XML contained `<!ENTITY` decl |
| `INVALID_PLACEHOLDER_TAG` | 400 | Tag/alias failed validation |
| `OVERLAPPING_PLACEHOLDER` | 409 | Wrap range crossed an existing SDT |
| `PLACEHOLDER_NOT_FOUND` | 404 | Tag or paraId unknown |
| `SNIPPET_CANNOT_CONTAIN_REQUISITES` | 422 | Snippet had nested `requisites:*` |
| `NO_RESOLVER_FOR_SCOPE` | 422 | Placeholder has scope no resolver handles |
| `RESOLVER_FAILED` | 502 | Resolver threw — host bug |
| `ABSENT_VALUE_IN_STRICT_MODE` | 422 | Strict-mode render hit a missing value |
| `TYPE_VALIDATION_FAILED` | 422 | Resolved value doesn't match declared DataType |
| `RENDER_TIMEOUT` | 504 | Render exceeded `renderTimeoutMs` |
| `STORAGE_FAILED` | 502 | StorageAdapter op threw |
| `AUTH_FORBIDDEN` | 403 | AuthAdapter denied |
| `VERSION_CONFLICT` | 409 | Optimistic-lock failure on `setCurrentVersion` |
| `IDEMPOTENCY_CONFLICT` | 409 | Key reused for a different request |
| `INTERNAL_ERROR` | 500 | Bug — file an issue |

The default error envelope is `{ error: { code, message, details } }`. Hosts can override via `app.setErrorHandler(...)` after registering `doccopRoutes`.

## i18n of error messages

`DocCopError.message` is English-only by design. Translate at the host boundary:

```typescript
function translateError(code: DocCopErrorCode, details: Record<string, unknown>): string {
  return i18n.t(`doccop.${code}`, details);
  // e.g. doccop.ABSENT_VALUE_IN_STRICT_MODE: "Не вистачає даних для '{tag}'"
}
```

`details` is a frozen JSON-serializable record — safe to use as your i18n parameter bag.

## Deployment recommendations

- **Fastify settings:** set `bodyLimit` ≥ your `maxUploadBytes`; enable `connectionTimeout` and `keepAliveTimeout` to match your load balancer.
- **Rate-limiter:** `@doccop/server` ships an in-memory limiter (`InMemoryRateLimiter`) — adequate single-instance. For multi-pod deployments, implement your own per-`userId` limiter using Redis and call `cfg.rateLimitFactory()` if you exposed one (or fork the route).
- **Blob storage:** S3, GCS, Azure Blob, Supabase Storage all fit the `StorageAdapter` interface. Use signed URLs (`signedUrl(path, expiresInSec)`) for direct browser downloads.
- **Postgres pool:** the Drizzle stores use whatever pool you wire in. For burst traffic, size `maxConnections` ≥ `maxConcurrentRendersPerUser × maxConcurrentUsers`.
- **Health checks:** doccop is stateless within the engine; the host's `/health` should check storage + DB + auth provider connectivity.

## Migration from existing systems

- **From docxtemplater:** placeholders use `{{tag}}` syntax in docxtemplater; doccop uses `<w:sdt>` content controls. Migration script: parse old template, find each `{{tag}}` text run, call `wrap()` with appropriate `WrapLocation`. The engine refuses overlapping wraps so you can re-run idempotently.
- **From template-strings-in-DB:** generate a `.docx` shell once, then use the visual editor (or the `wrap` API directly) to add SDTs. Variable resolution semantics move from string interpolation in your code to `EntityResolver.resolve`.
- **From Carbone:** Carbone uses `{d.field}` notation in tables. doccop's table support is identical to Word's — any table layout that opens in Word renders correctly through doccop.
