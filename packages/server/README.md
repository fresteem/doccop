# @doccop/server

Fastify plugin exposing [doccop](https://github.com/fresteem/doccop)'s engine over `/v1/*` HTTP endpoints. Handles auth, idempotency, rate-limiting, multipart `.docx` uploads, and the full `DocCopError → HTTP` status mapping.

**Status:** `0.2.0-beta.0` — feature-frozen for the `0.2.0` line.

## Install

```bash
npm install @doccop/server @doccop/core @fastify/multipart fastify
```

`@doccop/server` depends on `@doccop/core` exactly (no `^` — cross-package interface compatibility must agree).

## Register the plugin

```typescript
import fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { doccopRoutes } from "@doccop/server";

const app = fastify();
await app.register(fastifyMultipart);
await app.register(doccopRoutes, {
  config: {
    // Engine config (from @doccop/core)
    storage: myStorageAdapter,
    resolvers: [myPartyA, myPartyB, mySystem],
    requisitesResolver: mySnippetResolver,
    numbering: myNumberingService,
    naming: myNamingService,
    auth: myAuthAdapter,
    // Server stores (host-implemented — see Stores section)
    templates: myTemplateStore,
    templateVersions: myTemplateVersionStore,
    snippets: mySnippetStore,
    snippetVersions: mySnippetVersionStore,
    documents: myDocumentStore,
    idempotency: myIdempotencyStore,
    dataTypes: myDataTypeRegistry,
  },
});

await app.listen({ port: 3000 });
```

Mounts under `/v1` by default. To customise the prefix, register inside an outer scope:

```typescript
await app.register(async (scope) => {
  await scope.register(doccopRoutes, { config });
}, { prefix: "/api" });
// → POST /api/v1/documents, etc.
```

## Routes

| Method | Path | Purpose |
|---|---|---|
| `POST`   | `/v1/templates`                        | Upload a `.docx`, parse + normalise, create v1 |
| `GET`    | `/v1/templates`                        | List templates visible to the user |
| `GET`    | `/v1/templates/:id`                    | Template metadata |
| `GET`    | `/v1/templates/:id/preview`            | HTML preview + anchor map |
| `POST`   | `/v1/templates/:id/placeholders`       | Wrap inline / block placeholder (new version) |
| `DELETE` | `/v1/templates/:id/placeholders/:tag`  | Unwrap a placeholder |
| `POST`   | `/v1/snippets`                         | Upload a requisites snippet (admin-only) |
| `GET`    | `/v1/snippets`                         | List snippets |
| `DELETE` | `/v1/snippets/:id`                     | Delete a snippet |
| `POST`   | `/v1/documents`                        | Render a document (idempotency-keyed, rate-limited) |
| `GET`    | `/v1/documents`                        | List own documents |
| `GET`    | `/v1/documents/:id`                    | Download generated `.docx` |

Every endpoint validates input via Zod before the engine sees bytes. Engine errors map deterministically onto HTTP status codes — see the **[error mapping table in INTEGRATION.md](https://github.com/fresteem/doccop/blob/main/docs/INTEGRATION.md#error-handling)**.

## Stores you implement

Seven interfaces in `@doccop/server` (re-exported from this package):

- `TemplateStore`, `TemplateVersionStore`
- `SnippetStore`, `SnippetVersionStore`
- `DocumentStore`
- `IdempotencyStore` — atomic `(key, userId) → documentId`
- `DataTypeRegistry` — placeholder tag → `DataType`

Reference impls:

- **In-memory, ~250 LoC**: `packages/server/test/helpers.ts` in the [doccop repository](https://github.com/fresteem/doccop) — passes the full test suite, perfect copy-paste starting point.
- **Postgres + Drizzle**: install [`@doccop/storage-postgres`](https://www.npmjs.com/package/@doccop/storage-postgres) and drop in the seven concrete classes.

## Error handling

The default error envelope:

```json
{ "error": { "code": "STRING_CODE", "message": "...", "details": {} } }
```

Map by `code` for i18n (the `message` is English-only).

To override the envelope, register your own error handler **after** `doccopRoutes`:

```typescript
app.setErrorHandler((err, req, reply) => {
  if (err instanceof DocCopError) { /* your envelope */ }
  reply.status(500).send({ /* ... */ });
});
```

## Rate limiting

Ships an in-memory limiter (`InMemoryRateLimiter`) — single-instance only. For multi-pod deployments, swap in a Redis-backed limiter at the host level.

## Documentation

- **[Integration guide](https://github.com/fresteem/doccop/blob/main/docs/INTEGRATION.md)** — adapter implementations, deployment notes, migration patterns.
- **[demo-app](https://github.com/fresteem/doccop/tree/main/demo-app)** — Fastify server demo with in-memory stores you can `npm run start` immediately.

## License

MIT — see [LICENSE](./LICENSE).
