# Integration guide

How to embed doccop into a host application.

> **Status:** outline. Each section TODO before v1.0 stable. Owner: doccop-docs-writer.

## Decide your integration depth

Three integration shapes, increasing in commitment:

1. **HTTP-only**: run `@doccop/server` as a sidecar, talk to it from your existing backend over `/v1/*`. Lowest coupling.
2. **In-process**: register `doccopRoutes` as a Fastify plugin inside your own Fastify app. Auth + observability share the same instance.
3. **Library-only**: skip `@doccop/server` entirely, call `@doccop/core` directly. For non-HTTP hosts (workers, CLIs).

## Adapter checklist

Implement these against your host's data model:

### `StorageAdapter` (core)
TODO — methods, expected return values, error handling. Show how `FilesystemBlobStorage` does it.

### `EntityResolver[]` (core)
TODO — one resolver per scope (`party_a`, `party_b`, `system`, …). Patterns: ACL filtering, caching, returning `absent` vs throwing.

### `RequisitesResolver` (core)
TODO — lookup snippet by `(entityType, entitySubtype)`. Cache strategy.

### `NumberingService` + `NamingService` (core)
TODO — atomic allocation (advisory locks / sequences). The fest-ops `next_contract_number` RPC pattern.

### `AuthAdapter` (core, used by server)
TODO — `userIdFromRequest`, `canEditTemplate`, `canRenderTemplate`, `canManageSnippets`. JWT / session / API-key patterns.

### Server stores (`TemplateStore`, `TemplateVersionStore`, `SnippetStore`, `SnippetVersionStore`, `DocumentStore`, `IdempotencyStore`, `DataTypeRegistry`)
TODO — what each must do, optimistic locking expectations, atomicity requirements.

### `Logger` (optional)
TODO — wire pino/winston. Default no-op. Levels: trace/debug/info/warn/error.

## Error handling

TODO — `DocCopErrorCode` → HTTP status mapping table. `details` payload for client i18n. When to surface raw errors vs. translate.

## i18n

TODO — `code` is the i18n key. Host owns translation. Worked example: Ukrainian + English.

## Observability

TODO — what to log/trace at host boundary. Recommended fields for the render audit row.

## Deployment

TODO — recommended Fastify settings, rate-limit tuning, blob storage backends (S3 / GCS / Supabase Storage), Postgres connection pooling.

## Migration from existing systems

TODO — patterns for migrating from docxtemplater, Carbone, or template-strings-in-DB approaches.
