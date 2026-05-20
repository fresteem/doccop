/**
 * Fastify server demo — boots @doccop/server with in-memory stores,
 * sample resolvers, and a permissive AuthAdapter that trusts the
 * x-user-id header. Suitable for local exploration and integration
 * sanity-checks; NOT for production (no real auth, no persistence).
 *
 *   npm run start          # boots on http://localhost:3000
 *
 * Once running, try the curl examples in demo-app/README.md.
 */

import type {
  AllocateContext,
  AuthAdapter,
  NamingContext,
  NamingService,
  NumberingService,
  RequisitesResolver,
  UserId,
} from "@doccop/core";
import { type DoccopServerConfig, doccopRoutes } from "@doccop/server";
import fastifyMultipart from "@fastify/multipart";
import Fastify from "fastify";
import { demoResolvers } from "./resolvers.js";
import { buildInMemoryStores } from "./stores.js";

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
  // No snippets registered in the demo — returning null means strict-
  // mode renders that have a `requisites:*` SDT will fail with
  // AbsentValueInStrictModeError. The sample template has none, so
  // this is fine.
  async resolveSnippet() {
    return null;
  },
};

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

  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  await app.register(doccopRoutes, { config: cfg });

  // Tiny health endpoint so curl can confirm the server is up.
  app.get("/health", async () => ({ ok: true, doccop: "demo" }));

  const port = Number(process.env.PORT ?? "3000");
  const host = process.env.HOST ?? "127.0.0.1";

  await app.listen({ port, host });
  app.log.info({ port, host }, "doccop demo server listening");
  app.log.info("Try: curl -H 'x-user-id: demo-user' http://localhost:3000/v1/templates");
}

main().catch((err: unknown) => {
  console.error("server failed to start:", err);
  process.exit(1);
});
