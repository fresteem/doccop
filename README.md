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
| `demo-app` | Standalone Express + Postgres example app showing full integration. |

## Quickstart

_Coming in Wave 13 — packaging + docs._

## Repo layout

This repo is currently developed as a folder inside the [fest-ops](https://) host application for end-to-end iteration. It will be extracted to a standalone repository (`github.com/doccop-org`) via `git subtree split` once stable.

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
