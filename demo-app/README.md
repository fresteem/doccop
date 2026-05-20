# doccop demo-app

A runnable end-to-end example showing how to integrate `@doccop/core` and `@doccop/server` into a host application. Self-contained — no Postgres, no S3, no external services. Three modes:

- **CLI mode** (`npm run cli`) — builds a Ukrainian contract template in-memory, renders it through the engine, writes `output.docx`. Smallest possible library-only integration.
- **Server mode** (`npm run start` / `npm run dev`) — boots Fastify with all `/v1/*` routes wired against in-memory stores. Includes a **browser UI** at `http://localhost:3000/` with one-click contract generation, a placeholder inspector, and a health probe. `npm run dev` is the same but with `tsx watch` for hot reload during development.
- **HTTP integration testing** — curl the `/v1/*` endpoints directly. Examples below.

## Setup

From the **repo root** (recommended for a fresh clone — builds every workspace in dependency order):

```bash
npm install
npm run build
```

Or from **inside `demo-app/`** (if you've already built `@doccop/*` once):

```bash
cd demo-app
npm install        # only the first time
npm run build
```

Both paths work — `typescript` and `tsx` are declared as devDependencies on `demo-app` so its scripts run standalone.

## CLI mode

From inside `demo-app/`:

```bash
npm run cli
```

Or from the repo root (no `cd` needed):

```bash
npm run cli --workspace=doccop-demo-app
```

> The `--workspace=...` flag is only meaningful from the **repo root**. If you're already inside `demo-app/`, drop it — npm already knows which package you're in. Running `npm run cli --workspace=doccop-demo-app` from inside `demo-app/` fails with `No workspaces found` because npm looks for siblings starting from the current directory.

Expected output:

```
doccop demo (CLI mode)
────────────────────────────────────────────────────────────
Template built: 2451 bytes
Placeholders discovered: 11
  party_a.full_name              → alias "Сторона А — повна назва"
  party_a.director_name          → alias "Сторона А — директор"
  party_a.iban                   → alias "IBAN Сторони А"
  ...

Rendering...
────────────────────────────────────────────────────────────
✓ rendered in 24ms (engine reported 22ms)
✓ output: output.docx (2638 bytes)
✓ warnings: 0

Resolved values (audit trail — persisted as variablesSnapshot):
  party_a.full_name              = "ТОВ «ACME Україна»"
  party_a.director_name          = "Іваненко Іван Іванович"
  ...

Open output.docx in Microsoft Word to see the substituted contract.
```

`output.docx` is written to `demo-app/output.docx`. Open it in Word — every placeholder has been substituted, the SDT wrappers are gone (or rather, their content was replaced), and the document opens cleanly.

## Server mode + browser UI

From inside `demo-app/`:

```bash
npm run start
# or, with tsx watch + hot reload on src/ changes:
npm run dev
```

Or from the repo root (without `cd`):

```bash
npm run start --workspace=doccop-demo-app
# or:
npm run dev --workspace=doccop-demo-app
```

Then **open <http://localhost:3000/> in a browser**. The UI has three sections:

1. **Quick demo** — pick a Party A and a Party B from the dropdowns, click "Generate contract". The server builds the in-memory template, renders it through the engine, and returns a download link. Open the resulting `.docx` in Word.
2. **Inspect the template** — lists every placeholder the engine will resolve (tags, aliases, scopes, data types). Comes from `demo-app/src/template.ts`.
3. **Server health** — hits `GET /health` to confirm the process is up.

To pick a different port:

```bash
PORT=4000 HOST=0.0.0.0 npm run start
```

### Try the endpoints (curl)

All endpoints require the `x-user-id` header — the demo's `AuthAdapter` trusts any non-empty value (don't do this in production):

```bash
# Health check (not part of @doccop/server, added by the demo)
curl http://localhost:3000/health
# → {"ok":true,"doccop":"demo"}

# List templates (initially empty)
curl -H 'x-user-id: demo-user' http://localhost:3000/v1/templates
# → {"templates":[]}
```

### Upload a template

The CLI demo's sample template can be reused. From a second terminal:

```bash
# Step 1: generate the template bytes via the CLI demo
npm run cli --workspace=doccop-demo-app
# This writes output.docx — but for upload we want the TEMPLATE, not
# the rendered output. Adjust the CLI to also dump template bytes, or
# author your own .docx in Word.

# Step 2: upload (using output.docx as a stand-in; in real use this
# would be a fresh template authored in Word)
curl -X POST http://localhost:3000/v1/templates \
  -H 'x-user-id: demo-user' \
  -F 'meta={"name":"Demo Contract","partyCount":2};type=application/json' \
  -F 'file=@output.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document'
# → 201 with { template: {...}, version: {...} }
```

### Render a document

```bash
# Replace TEMPLATE_ID with the id you received from the upload response
curl -X POST http://localhost:3000/v1/documents \
  -H 'x-user-id: demo-user' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: contract-2026-001' \
  -d '{
    "templateId": "TEMPLATE_ID",
    "parties": [
      {"role": "party_a", "entityType": "organization", "entityId": "internal-acme"},
      {"role": "party_b", "entityType": "organization", "entityId": "external-clientx"}
    ]
  }'
# → 201 with { document: {...}, warnings: [], durationMs: ... }
```

### Download the rendered document

```bash
# Replace DOCUMENT_ID with the id from the render response
curl -H 'x-user-id: demo-user' \
  http://localhost:3000/v1/documents/DOCUMENT_ID \
  --output rendered.docx
```

## What's NOT in this demo

The demo exists to show the wiring, not the deployment story. Pieces deliberately omitted:

| Skipped | Production equivalent |
|---|---|
| Persistence | `@doccop/storage-postgres` (Drizzle stores + filesystem blob) or your own DB-backed store implementations |
| Auth | A real `AuthAdapter` (JWT, session, OAuth) — see `docs/INTEGRATION.md` |
| Snippets | A `RequisitesResolver` backed by your snippet store; sample template has no `requisites:*` placeholders so this is a no-op here |
| Rate limiting | `@doccop/server` ships an in-memory limiter; multi-pod needs Redis or similar |
| TLS, observability, deploy | Host concerns |

## File layout

```
demo-app/
├── package.json
├── tsconfig.json
├── README.md                  (this file)
└── src/
    ├── cli.ts                 (entry point for `npm run cli`)
    ├── server.ts              (entry point for `npm run start`)
    ├── stores.ts              (in-memory implementations of all 7 server stores)
    ├── resolvers.ts           (party_a / party_b / system EntityResolvers)
    └── template.ts            (programmatic Ukrainian contract template)
```

## Troubleshooting

**`Cannot find module '@doccop/core'`** — run `npm install && npm run build` from the repo root. `@doccop/*` are workspace packages and the demo needs them built before they resolve.

**Render returns warnings instead of values** — strict mode is enabled, so this shouldn't happen for the sample template. If you customised resolvers to return `absent`, set `strictRender: false` in `server.ts` or pass `strict: false` per request in the body. See `docs/QUICKSTART.md` for the strict-vs-non-strict tradeoff.

**`output.docx` opens but looks blank** — your Word version may not render the styles we emit. Try LibreOffice Writer; if the document also looks blank there, file a bug with the `.docx` attached.

**Want Postgres-backed stores?** Replace `buildInMemoryStores()` in `server.ts` with the `@doccop/storage-postgres` `PostgresTemplateStore` family. See that package's README for the wiring.

## Next steps for integrators

1. Walk through [`../docs/QUICKSTART.md`](../docs/QUICKSTART.md) with this demo running.
2. Read [`../docs/INTEGRATION.md`](../docs/INTEGRATION.md) — adapter-by-adapter, with code samples that match the shape of `stores.ts` / `resolvers.ts` here.
3. Copy `stores.ts` into your host, port each in-memory class to your DB.
4. Replace `demoAuth` with your real auth adapter.
5. Replace `buildSampleTemplate()` with actual user-uploaded templates via the `/v1/templates` route.
