/**
 * @doccop/server — Fastify plugin exposing /v1/* routes.
 *
 * Usage:
 *   const app = fastify();
 *   await app.register(fastifyMultipart);
 *   await app.register(doccopRoutes, { config, prefix: "/api" });
 *
 * The plugin owns:
 *  - Request auth via the configured AuthAdapter (sets req.userId).
 *  - Engine error → HTTP status mapping.
 *  - Rate limiting on /v1/documents POST.
 *  - Idempotency-Key handling on /v1/documents POST.
 *
 * Hosts retain full control of the Fastify instance — add their own
 * routes, middleware, logging, observability.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { DoccopServerConfig } from "./config.js";
import { authPreHandler } from "./middleware/auth.js";
import { fastifyErrorHandler } from "./middleware/errors.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerSnippetRoutes } from "./routes/snippets.js";
import { registerTemplateRoutes } from "./routes/templates.js";

export type { DoccopServerConfig } from "./config.js";
export { withDefaults } from "./config.js";
export type {
  DataTypeRegistry,
  DocumentStore,
  GeneratedDocumentRecord,
  IdempotencyStore,
  SnippetRecord,
  SnippetStore,
  SnippetVersionRecord,
  SnippetVersionStore,
  TemplateRecord,
  TemplateStore,
  TemplateVersionRecord,
  TemplateVersionStore,
} from "./types.js";
export { InMemoryRateLimiter } from "./middleware/rate-limit.js";

interface PluginOptions {
  config: DoccopServerConfig;
}

/**
 * Fastify plugin: register all `/v1/*` routes on the host instance.
 * The host is expected to register `@fastify/multipart` before this.
 */
export const doccopRoutes: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const cfg = opts.config;

  // Error handler for the entire route set (overrides Fastify's default).
  app.setErrorHandler(fastifyErrorHandler);

  // Per-request auth: sets req.userId or returns 401.
  app.addHook("preHandler", (req, reply) => authPreHandler(cfg.auth, req, reply));

  // Mount the three route bundles under the plugin's prefix.
  await app.register(
    async (scope: FastifyInstance) => {
      registerTemplateRoutes(scope, cfg);
      registerSnippetRoutes(scope, cfg);
      registerDocumentRoutes(scope, cfg);
    },
    { prefix: "/v1" },
  );
};
