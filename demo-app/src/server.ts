/**
 * Fastify server demo — boots @doccop/server with in-memory stores,
 * sample resolvers, and a permissive AuthAdapter that trusts the
 * x-user-id header. Suitable for local exploration and integration
 * sanity-checks; NOT for production (no real auth, no persistence).
 *
 *   npm run start          # boots on http://localhost:3000
 *   npm run dev            # same but with tsx watch (hot reload)
 *
 * Browser UI lives at the root (/) — served from public/index.html.
 * Engine endpoints under /v1/* (templates, snippets, documents). Two
 * helper endpoints used by the UI:
 *   GET  /api/template-info   — list placeholders in the built-in template
 *   POST /api/quick-demo      — build template, render, return download URL
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureParaIds, list, parse, render } from "@doccop/core";
import type {
  AllocateContext,
  AuthAdapter,
  NamingContext,
  NamingService,
  NumberingService,
  RenderConfig,
  RenderRequest,
  RequisitesResolver,
  UserId,
} from "@doccop/core";
import { type DoccopServerConfig, doccopRoutes } from "@doccop/server";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { demoResolvers } from "./resolvers.js";
import { buildInMemoryStores } from "./stores.js";
import { buildSampleTemplate } from "./template.js";

// ─── Adapters that the engine needs but the demo treats trivially ─────────

const demoAuth: AuthAdapter = {
  async userIdFromRequest(req: unknown): Promise<UserId | null> {
    const headers = (req as { headers?: Record<string, string> }).headers ?? {};
    const id = headers["x-user-id"];
    return typeof id === "string" && id.length > 0 ? id : null;
  },
  async canEditTemplate() {
    return true;
  },
  async canRenderTemplate() {
    return true;
  },
  async canManageSnippets() {
    return true;
  },
};

let counter = 0;
const demoNumbering: NumberingService = {
  async allocate(ctx: AllocateContext): Promise<string> {
    counter += 1;
    const seq = String(counter).padStart(3, "0");
    const category = ctx.templateCategory ?? "DOC";
    return `${seq}-${ctx.year}/${category}`;
  },
};

const demoNaming: NamingService = {
  format(ctx: NamingContext): string {
    return `${ctx.number.replace(/\//g, "_")}_${ctx.templateName}`;
  },
};

const demoRequisitesResolver: RequisitesResolver = {
  // No snippets registered in the demo — returning null is fine since
  // the built-in template has no requisites:* blocks.
  async resolveSnippet() {
    return null;
  },
};

// ─── In-memory document store keyed by id, for the /api/quick-demo flow ───

const generatedDocs = new Map<string, { bytes: Uint8Array; filename: string }>();

async function buildAndRender(
  partyAEntityId: string,
  partyBEntityId: string,
): Promise<{
  bytes: Uint8Array;
  filename: string;
  documentNumber: string;
  warnings: ReturnType<typeof render> extends Promise<infer R>
    ? R extends { warnings: infer W }
      ? W
      : never
    : never;
  resolvedValues: Record<string, string>;
  durationMs: number;
}> {
  const archive = parse(buildSampleTemplate());
  ensureParaIds(archive);

  counter += 1;
  const documentNumber = `${String(counter).padStart(3, "0")}-2026/CONTRACT`;

  const request: RenderRequest = {
    userId: "demo-user",
    templateId: "demo-template",
    templateVersionId: "demo-v1",
    templateCategory: "CONTRACT",
    documentNumber,
    parties: [
      { role: "party_a", entityType: "organization", entityId: partyAEntityId },
      { role: "party_b", entityType: "organization", entityId: partyBEntityId },
    ],
    now: new Date(),
  };
  const config: RenderConfig = { resolvers: demoResolvers };
  const result = await render(archive, request, config);

  const filename = `${documentNumber.replace(/\//g, "_")}.docx`;
  return {
    bytes: result.docx,
    filename,
    documentNumber,
    warnings: result.warnings,
    resolvedValues: result.resolvedValues,
    durationMs: result.durationMs,
  };
}

// ─── Boot ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const stores = buildInMemoryStores();

  const cfg: DoccopServerConfig = {
    ...stores,
    resolvers: demoResolvers,
    requisitesResolver: demoRequisitesResolver,
    numbering: demoNumbering,
    naming: demoNaming,
    auth: demoAuth,
    strictRender: true,
  };

  const app = Fastify({ logger: { level: "info" } });

  // Static UI at /.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // When running compiled (npm run start), __dirname is dist/. When
  // running via tsx watch (npm run dev), __dirname is src/. Both are
  // siblings of public/.
  const publicDir = join(__dirname, "..", "public");
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    decorateReply: false,
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  await app.register(doccopRoutes, { config: cfg });

  // Health endpoint (also reported by the UI's "Ping" button).
  app.get("/health", async () => ({ ok: true, doccop: "demo" }));

  // UI helper: list placeholders in the built-in template.
  app.get("/api/template-info", async () => {
    const archive = parse(buildSampleTemplate());
    ensureParaIds(archive);
    const placeholders = list(archive).map((p) => ({
      tag: p.tag,
      alias: p.alias,
      scope: p.scope,
      key: p.key,
      dataType: p.dataType,
    }));
    return { placeholders };
  });

  // UI helper: render the built-in template against chosen party
  // identifiers, store the bytes in memory, return a download URL.
  app.post<{ Body: { partyA: string; partyB: string } }>("/api/quick-demo", async (req, reply) => {
    const { partyA, partyB } = req.body ?? { partyA: "", partyB: "" };
    if (!partyA || !partyB) {
      reply.status(400);
      return { error: "partyA and partyB are required" };
    }
    try {
      const result = await buildAndRender(partyA, partyB);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      generatedDocs.set(id, { bytes: result.bytes, filename: result.filename });
      return {
        documentNumber: result.documentNumber,
        filename: result.filename,
        warnings: result.warnings,
        resolvedValues: result.resolvedValues,
        durationMs: result.durationMs,
        downloadUrl: `/api/quick-demo/download/${id}`,
      };
    } catch (err) {
      req.log.error({ err }, "quick-demo render failed");
      reply.status(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // UI helper: stream the previously-rendered .docx bytes.
  app.get<{ Params: { id: string } }>("/api/quick-demo/download/:id", async (req, reply) => {
    const doc = generatedDocs.get(req.params.id);
    if (!doc) {
      reply.status(404);
      return { error: "not found or expired" };
    }
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .header("content-disposition", `attachment; filename="${encodeURIComponent(doc.filename)}"`)
      .send(Buffer.from(doc.bytes));
    return reply;
  });

  const port = Number(process.env.PORT ?? "3000");
  const host = process.env.HOST ?? "127.0.0.1";

  await app.listen({ port, host });
  app.log.info({ port, host }, "doccop demo server listening");
  app.log.info(`open http://${host}:${port}/ in a browser for the UI`);
}

main().catch((err: unknown) => {
  console.error("server failed to start:", err);
  process.exit(1);
});
