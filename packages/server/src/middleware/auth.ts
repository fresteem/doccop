/**
 * Authentication hook + per-request user-id propagation.
 *
 * The plugin reads the user id from the configured `AuthAdapter` once
 * per request and decorates the request with `userId`. Routes can then
 * read `req.userId` without re-auth.
 *
 * 401 if the adapter returns null. The error envelope mirrors the
 * standard error shape so clients can handle it uniformly.
 */

import type { AuthAdapter, UserId } from "@doccop/core";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    userId: UserId;
  }
}

export async function authPreHandler(
  auth: AuthAdapter,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = await auth.userIdFromRequest(req);
  if (!userId) {
    reply.status(401).send({
      error: { code: "UNAUTHENTICATED", message: "Authentication required" },
    });
    return;
  }
  req.userId = userId;
}
