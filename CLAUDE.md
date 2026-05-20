# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `doccop/` (the inner directory containing `package.json`):

```bash
npm install           # install all workspaces
npm run build         # tsc build all packages
npm test              # vitest run across all packages
npm run lint          # biome check .
npm run format        # biome format --write .
npm run typecheck     # tsc --noEmit across all packages
npm run clean         # remove dist/ and node_modules/
```

Per-package:
```bash
npm run build -w packages/core
npm test -w packages/core
```

Single test file (from within the package directory):
```bash
npx vitest run test/placeholders/PlaceholderEngine.test.ts
```

## Architecture

npm workspaces monorepo with three published packages:

- **`@doccop/core`** — Pure engine, no I/O. Depends only on `@xmldom/xmldom` and `pizzip`.
- **`@doccop/server`** — Fastify plugin wrapping the core. Registers `/v1/*` routes for templates, snippets, and document generation.
- **`@doccop/storage-postgres`** — Drizzle-backed Postgres reference implementation of every store interface defined in `@doccop/server/types`.

### Core subsystems (`packages/core/src/`)

| Subsystem | Files | What it does |
|---|---|---|
| `docx/` | `DocxParser`, `AnchorMapper`, `xml-utils` | Parse/serialize `.docx` ZIP; expose `DocxArchive` (xmldom Document + raw parts map); paragraph anchor lookups via `w14:paraId` |
| `placeholders/` | `PlaceholderEngine`, `TagValidator`, `SdtBuilder` | CRUD on Word SDT (`<w:sdt>`) nodes: `wrap`, `unwrap`, `list`, `replace`. Tags are `<scope>.<key>` or `requisites:<party>` |
| `preview/` | `HtmlRenderer`, `style-mapper` | Render a `DocxArchive` to HTML for editor preview; returns anchor map for click-to-select |
| `render/` | `DocxRenderer`, `VariableContext`, `typeValidators` | Two-phase render: (1) expand `requisites:*` SDTs by calling `RequisitesEngine`, (2) resolve all value placeholders via `EntityResolver`s |
| `requisites/` | `RequisitesEngine` + remappers | Inject a snippet docx into a master docx at the `requisites:party_*` SDT, remapping styles/numbering/bookmarks to avoid collisions |

### Data flow for document generation

```
render request (parties + templateId)
  → DocxRenderer.render()
    → Phase 1: for each requisites:party_* SDT
        → RequisitesResolver.resolveSnippet(entityType, entitySubtype)
        → rewrite snippet bare-key tags to party_X.<key>
        → inject snippet body into master (StyleRemapper, NumberingRemapper, XmlInjector)
    → Phase 2: for each value SDT
        → EntityResolver.resolve(key, ctx)
        → validateValue(dataType, ...)
        → PlaceholderEngine.replace(archive, tag, value)
  → serialize to Uint8Array
```

`DocxArchive` is immutable by convention — every mutation function clones the archive first and returns a fresh copy.

### Server layer (`packages/server/src/`)

`doccopRoutes` is a Fastify plugin; hosts register it with a `DoccopServerConfig`. The config bundles stores (defined in `server/types.ts`) and a `DocCopConfig` from core. Routes are in `routes/templates.ts`, `routes/snippets.ts`, `routes/documents.ts`.

Store interfaces (`TemplateStore`, `TemplateVersionStore`, `SnippetStore`, etc.) are defined in `server/types.ts` — the server package does not depend on `storage-postgres`; hosts wire the two together.

### Postgres storage (`packages/storage-postgres/`)

Drizzle schema in `src/schema.ts`. Tables all prefixed `doccop_`. Initial migration at `migrations/0000_init.sql`. `FilesystemBlobStorage` is the reference `StorageAdapter` (blobs on disk); production hosts swap in Supabase/S3/GCS.

## Conventions

- **ESM throughout**: all source uses `.js` import extensions even from `.ts` files.
- **No default exports** (Biome enforces) except `*.config.ts` files.
- **`useImportType` / `useExportType`** enforced by Biome — always `import type` for type-only imports.
- **Strict TypeScript**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`.
- **Typed errors only**: throw subclasses of `DocCopError` from `errors.ts`, never plain strings.
- **No imports across package boundaries** at the source level — packages integrate via published interfaces only.
- All commercial-license transitive dependencies are banned (CI SBOM check).
- Placeholder tags format: `party_a.full_name` (value) or `requisites:party_a` (block injection).
