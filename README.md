# doccop

> OSS document generation engine — .docx templating with visual placeholder editor and per-entity-subtype requisite blocks.

**Status:** pre-alpha — Wave 1 of 14.

## What it does

doccop is a database-agnostic, framework-agnostic engine for generating `.docx` documents from templates. Key features:

- **Visual placeholder editor** — highlight text in a template, bind it to a variable, save as a new template version. Placeholders use Word-native SDT (Structured Document Tags) so templates open cleanly in Microsoft Word.
- **Per-subtype requisite blocks** — define separate sub-templates per entity type (e.g. legal forms TOV/FOP/PP in Ukraine), inject them at render time based on the resolved entity's subtype.
- **Pluggable variable resolution** — host application provides `EntityResolver` implementations for its data model (no hard dependency on any specific schema).
- **Pluggable storage** — reference PostgreSQL implementation included; bring your own via the `StorageAdapter` interface.
- **PDF on demand** — via Gotenberg (Docker) sidecar; never persisted unless the host wants to.
- **MIT licensed** end-to-end (no commercial library dependencies).

## Packages

| Package | What |
|---|---|
| `@doccop/core` | Engine: docx parsing, SDT manipulation, variable resolution, requisites injection. No I/O. |
| `@doccop/server` | Fastify HTTP server wrapping the core for typical web integration. |
| `@doccop/storage-postgres` | Drizzle-backed reference storage adapter. |
| `@doccop/react-ui` | React components for the template editor and generation flow. |
| `demo-app` | Standalone Fastify + Postgres example app showing full integration. |

## Quickstart

```bash
npm install @doccop/core @doccop/server @doccop/storage-postgres
```

Minimal in-process render — no HTTP, no DB:

```typescript
import { parse, render } from "@doccop/core";
import type { EntityResolver, RenderConfig, RenderRequest } from "@doccop/core";

const partyA: EntityResolver = {
  scope: "party_a",
  async resolve(key) {
    if (key === "full_name") return { kind: "text", value: "ACME Ltd" };
    return { kind: "absent" };
  },
};

const template = parse(fs.readFileSync("contract-template.docx"));
const result = await render(template, /* RenderRequest */ {
  userId: "u1", templateId: "t1", templateVersionId: "v1",
  templateCategory: null, documentNumber: "001/2026",
  parties: [{ role: "party_a", entityType: "organization", entityId: "acme" }],
  now: new Date(),
}, /* RenderConfig */ { resolvers: [partyA] });

fs.writeFileSync("contract.docx", result.docx);
```

Full walkthroughs:

- [`docs/QUICKSTART.md`](./docs/QUICKSTART.md) — install → first render in ten minutes.
- [`docs/INTEGRATION.md`](./docs/INTEGRATION.md) — wire `@doccop/server` into a Fastify host with stores, auth, storage.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — internal design, two-phase render, requisites pipeline.
- [`docs/RELEASE_PROCESS.md`](./docs/RELEASE_PROCESS.md) — versioning, support matrix, deprecation policy.

## Repo layout

This is a standalone OSS project. The engine was originally developed as a folder inside a host application (`fest-ops`) for end-to-end iteration, then extracted via `git subtree split` to this repo (`github.com/fresteem/doccop`).

```
doccop/
├── packages/
│   ├── core/                 # The engine
│   ├── server/               # Fastify HTTP layer (Wave 7)
│   ├── storage-postgres/     # Postgres reference adapter (Wave 8)
│   ├── react-ui/             # React components (Wave 14)
│   └── demo-app/             # Reference integration (Wave 13)
├── docs/                     # Architecture + integration guides
└── docker/                   # Gotenberg compose, dev infra
```

## License

MIT © doccop contributors. See [LICENSE](./LICENSE).
