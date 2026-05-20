# Quickstart

From "I've never seen doccop" to "I rendered my first document" in under ten minutes. This guide stays library-only (no HTTP, no DB) so you can run every snippet in a Node REPL or a script.

## Prerequisites

- Node ≥ 20
- A `.docx` template authored in Microsoft Word (or LibreOffice). For this walkthrough, save any one-paragraph document as `template.docx`.

## 1. Install

```bash
npm install @doccop/core
```

`@doccop/core` is the pure engine. You do not need `@doccop/server` or `@doccop/storage-postgres` for the basic in-process render shown below.

## 2. Wrap a placeholder

You can either author the placeholder visually in Word (insert a "content control" with tag `party_a.full_name`) or write the SDT programmatically. For the quickstart we'll do it programmatically so you can paste-and-run.

```typescript
import fs from "node:fs";
import { ensureParaIds, list, parse, serialize, wrap } from "@doccop/core";

const archive = parse(fs.readFileSync("template.docx"));
ensureParaIds(archive); // mint w14:paraId on paragraphs that lack one

// Grab the first paragraph's paraId.
const paragraphs = list(archive); // currently empty: no placeholders yet
const firstParaId = /* however you discover this */ "AAAA0001";

const wrapped = wrap(
  archive,
  { paraId: firstParaId, startRunIndex: 0, startOffset: 0, endRunIndex: 0, endOffset: 5 },
  { tag: "party_a.full_name", alias: "Party A — full name", dataType: "text" },
);

fs.writeFileSync("template-with-placeholder.docx", serialize(wrapped));
```

The `WrapLocation` shape — `paraId`, `startRunIndex`, `startOffset`, `endRunIndex`, `endOffset` — comes from the [HTML preview](./ARCHITECTURE.md#preview-subsystem). In a real editor, the user clicks on rendered HTML; you read `data-anchor-id` and the selection's run indices and offsets.

## 3. Provide an `EntityResolver`

A resolver answers "what's the value of placeholder X for this party?". You implement one per scope (`party_a`, `party_b`, …, `system`, `custom`):

```typescript
import type { EntityResolver } from "@doccop/core";

const partyAResolver: EntityResolver = {
  scope: "party_a",
  async resolve(key, ctx) {
    // `ctx.parties.party_a` gives you { role, entityType, entityId } —
    // use entityId to look up your domain object. For the quickstart we
    // just match by key.
    if (key === "full_name") return { kind: "text", value: "ACME Ltd" };
    if (key === "edrpou") return { kind: "text", value: "12345678" };
    return { kind: "absent", reason: `unknown key ${key}` };
  },
};
```

Returning `{ kind: "absent" }` (rather than throwing) lets strict mode fail loudly with `AbsentValueInStrictModeError`, and lets non-strict mode collect a warning. **Never throw a plain `Error` from a resolver** — it bubbles up as `ResolverFailedError`.

## 4. Render

```typescript
import { render } from "@doccop/core";
import type { RenderConfig, RenderRequest } from "@doccop/core";

const request: RenderRequest = {
  userId: "user-1",
  templateId: "t-1",
  templateVersionId: "tv-1",
  templateCategory: null,
  documentNumber: "001-2026/CONSULT",
  parties: [
    { role: "party_a", entityType: "organization", entityId: "acme" },
  ],
  now: new Date(),
};

const config: RenderConfig = { resolvers: [partyAResolver] };

const result = await render(wrapped, request, config);
fs.writeFileSync("contract.docx", result.docx);
console.log("warnings:", result.warnings);  // []
console.log("resolved:", result.resolvedValues); // { "party_a.full_name": "ACME Ltd" }
```

Open `contract.docx` in Word — you should see "ACME Ltd" where the placeholder was. Done.

## 5. Common next steps

- **Multi-party contracts**: add resolvers for `party_b`, `party_c`, … One resolver per party slot. See [`docs/INTEGRATION.md`](./INTEGRATION.md#entityresolver-core).
- **System variables**: add a resolver with `scope: "system"` for `system.today`, `system.contract_number`, etc.
- **Requisites blocks (per-subtype)**: mark a whole-paragraph region as `requisites:party_a` (use `wrapBlock`) and supply a `RequisitesResolver`. The engine injects per-`entitySubtype` snippet bodies at render time. See [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md#requisites-injection).
- **HTTP wrapping**: register `@doccop/server` as a Fastify plugin to expose `/v1/templates`, `/v1/snippets`, `/v1/documents` REST endpoints. See [`docs/INTEGRATION.md`](./INTEGRATION.md#http-only-integration).
- **Persistence**: implement `StorageAdapter` + the seven server stores against your DB. The Postgres reference impl in `@doccop/storage-postgres` is a working starting point, and `packages/server/test/helpers.ts` contains ~250 LoC of in-memory implementations that pass the full integration test suite.

## Strict vs non-strict mode

`RenderConfig.options.strict` defaults to `true`. In strict mode any missing resolver / absent value / type-validation failure throws and the render aborts with no partial output. Strict mode is the right default for production — document generation is a high-stakes operation and silent gaps are how the wrong contract reaches a client.

Set `{ options: { strict: false } }` for preview-time renders, where you want a marker text (`{missing: party_a.k}`) plus a `RenderWarning[]` instead of an exception.
