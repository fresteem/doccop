# @doccop/core

The pure engine of [doccop](https://github.com/fresteem/doccop) — `.docx` parsing, SDT-based placeholder manipulation, two-phase render with variable substitution, and per-subtype "requisites" block injection. No I/O. No HTTP. No database. Just functions over a `DocxArchive`.

**Status:** `0.2.0-beta.0` — feature-frozen for the `0.2.0` line; behavioural fixes only until stable.

## Install

```bash
npm install @doccop/core
```

Runtime deps: `pizzip` (MIT) + `@xmldom/xmldom` (MIT). Both vendored licenses are MIT or MIT-compatible.

## Minimal example

```typescript
import fs from "node:fs";
import { parse, render } from "@doccop/core";
import type { EntityResolver, RenderConfig, RenderRequest } from "@doccop/core";

const archive = parse(fs.readFileSync("contract-template.docx"));

const partyA: EntityResolver = {
  scope: "party_a",
  async resolve(key) {
    if (key === "full_name") return { kind: "text", value: "ACME Ltd" };
    return { kind: "absent", reason: `unknown key ${key}` };
  },
};

const request: RenderRequest = {
  userId: "user-1",
  templateId: "t-1",
  templateVersionId: "tv-1",
  templateCategory: null,
  documentNumber: "001/2026",
  parties: [{ role: "party_a", entityType: "organization", entityId: "acme" }],
  now: new Date(),
};

const config: RenderConfig = { resolvers: [partyA] };

const result = await render(archive, request, config);
fs.writeFileSync("contract.docx", result.docx);
```

## What this package exposes

| Subsystem | Functions |
|---|---|
| **docx** | `parse`, `serialize`, `ensureParaIds`, `listParagraphs`, `findByParaId` |
| **placeholders** | `list`, `wrap`, `wrapBlock`, `unwrap`, `replace`, `decomposeTag`, `validateAlias` |
| **preview** | `preview` (returns `{ html, anchors }` for in-browser editors) |
| **render** | `render` (the substitution pipeline), `validateValue` |
| **requisites** | `injectRequisites`, `resolveAndInject`, `serializeArchive` |

All types (`EntityResolver`, `RequisitesResolver`, `StorageAdapter`, `Placeholder`, `DocCopConfig`, etc.) are exported. The 19 `DocCopError` subclasses are the engine's exception surface — branch on `error.code` for HTTP / i18n mapping.

## When to reach for the server / storage packages

- Wrap the engine in an HTTP API with auth + idempotency + rate-limit → **[`@doccop/server`](https://www.npmjs.com/package/@doccop/server)** (Fastify plugin).
- Persist templates / snippets / documents in Postgres via Drizzle → **[`@doccop/storage-postgres`](https://www.npmjs.com/package/@doccop/storage-postgres)** (reference store implementations + filesystem blob storage).

## Documentation

- **[Quickstart](https://github.com/fresteem/doccop/blob/main/docs/QUICKSTART.md)** — install → first rendered document in under ten minutes.
- **[Integration guide](https://github.com/fresteem/doccop/blob/main/docs/INTEGRATION.md)** — adapter-by-adapter walkthrough (storage, resolvers, auth, stores).
- **[Architecture](https://github.com/fresteem/doccop/blob/main/docs/ARCHITECTURE.md)** — internal design, two-phase render, requisites pipeline.
- **[demo-app](https://github.com/fresteem/doccop/tree/main/demo-app)** — runnable end-to-end Fastify + in-memory stores example.

## Compatibility

- Node ≥ 20 (uses `node:fs/promises`, ESM, `URL`).
- ESM only. CommonJS hosts: use dynamic `import()`.
- TypeScript: strict mode supported, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

## License

MIT — see [LICENSE](./LICENSE).
