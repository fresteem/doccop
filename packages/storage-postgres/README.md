# @doccop/storage-postgres

Drizzle-ORM-backed reference implementations of every [`@doccop/server`](https://www.npmjs.com/package/@doccop/server) store interface, plus a filesystem-backed `StorageAdapter` for blob persistence. Hosts running on Postgres can drop these in directly; others use them as a porting target.

**Status:** `0.2.0-beta.0` — feature-frozen for the `0.2.0` line.

## Install

```bash
npm install @doccop/storage-postgres @doccop/server @doccop/core drizzle-orm postgres
```

All dependencies pinned exactly to keep the cross-package interface contract intact.

## Wire it up

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as doccop from "@doccop/storage-postgres";

const sql = postgres(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema: doccop.schema });

const config = {
  // Engine deps (from @doccop/core) go here:
  storage: new doccop.FilesystemBlobStorage({ rootDir: "./blobs" }),
  resolvers: [/* your EntityResolvers */],
  // ...

  // Stores from this package:
  templates: new doccop.PostgresTemplateStore(db),
  templateVersions: new doccop.PostgresTemplateVersionStore(db),
  snippets: new doccop.PostgresSnippetStore(db),
  snippetVersions: new doccop.PostgresSnippetVersionStore(db),
  documents: new doccop.PostgresDocumentStore(db),
  idempotency: new doccop.PostgresIdempotencyStore(db),
  dataTypes: new doccop.PostgresDataTypeRegistry(db),
};
```

## Apply the schema

The package ships an idempotent migration:

```bash
psql "$DATABASE_URL" < node_modules/@doccop/storage-postgres/migrations/0000_init.sql
```

Or apply it through your existing migration runner (drizzle-kit, node-pg-migrate, sqitch — anything). All tables are prefixed `doccop_` so they coexist with any host schema.

## What's included

| Class | Replaces interface |
|---|---|
| `PostgresTemplateStore` | `TemplateStore` |
| `PostgresTemplateVersionStore` | `TemplateVersionStore` |
| `PostgresSnippetStore` | `SnippetStore` |
| `PostgresSnippetVersionStore` | `SnippetVersionStore` |
| `PostgresDocumentStore` | `DocumentStore` |
| `PostgresIdempotencyStore` | `IdempotencyStore` |
| `PostgresDataTypeRegistry` | `DataTypeRegistry` |
| `FilesystemBlobStorage` | `StorageAdapter` (for local dev / demos) |

Production deployments typically swap `FilesystemBlobStorage` for an S3 / GCS / Azure Blob / Supabase Storage adapter. The `StorageAdapter` interface is small (8 methods); implement it against your blob store directly.

## Operational notes

- **Optimistic locking**: `PostgresTemplateStore.setCurrentVersion` uses `UPDATE … WHERE current_version_id = expected`. Returns `null` on conflict — the server maps this to `409 Conflict`.
- **Idempotency cleanup**: `PostgresIdempotencyStore.cleanupOlderThan(date)` is provided for host cron jobs. Recommended retention: 24h.
- **Connection pool**: the package never opens its own connection — wire in whatever pool sizing your host uses.

## Schema

Tables (all prefixed `doccop_`):

```
doccop_templates                doccop_template_versions
doccop_snippets                 doccop_snippet_versions
doccop_generated_documents      doccop_idempotency
doccop_variables                (enum doccop_visibility)
```

Drizzle table definitions are exported as `schema.*` for inclusion in your own Drizzle config.

## Documentation

- **[Integration guide](https://github.com/fresteem/doccop/blob/main/docs/INTEGRATION.md)** — full adapter contract, error mapping, deployment recommendations.
- **[demo-app](https://github.com/fresteem/doccop/tree/main/demo-app)** — runnable example showing the full wiring.

## License

MIT — see [LICENSE](./LICENSE).
