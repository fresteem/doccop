/**
 * Coverage targets:
 * - POST /v1/documents: renders, returns 201 + document + warnings
 * - POST /v1/documents: Idempotency-Key returns cached result
 * - POST /v1/documents: rate limited after N requests
 * - POST /v1/documents: 422 on strict-mode resolution failure
 * - GET /v1/documents: lists owner's documents
 * - GET /v1/documents/:id: serves docx blob
 * - GET /v1/documents/:id: 403 for other owners
 */

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestRig, buildTestServer, staticResolver, tinyDocxBytes } from "../helpers.js";

let rig: TestRig;
const AUTH = { "x-user-id": "user-1" };

beforeEach(async () => {
  rig = await buildTestServer();
});
afterEach(async () => {
  await rig.app.close();
});

async function uploadTemplate(text = "Hello") {
  const boundary = "----doccop-test";
  const file = tinyDocxBytes(text);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="meta"\r\n\r\n'),
    Buffer.from(`${JSON.stringify({ name: "T" })}\r\n`),
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(
      'Content-Disposition: form-data; name="file"; filename="t.docx"\r\nContent-Type: application/octet-stream\r\n\r\n',
    ),
    Buffer.from(file),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await rig.app.inject({
    method: "POST",
    url: "/v1/templates",
    headers: { ...AUTH, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  return JSON.parse(res.body);
}

async function render(
  templateId: string,
  opts: { idempotencyKey?: string; strict?: boolean } = {},
) {
  const headers: Record<string, string> = { ...AUTH, "content-type": "application/json" };
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return rig.app.inject({
    method: "POST",
    url: "/v1/documents",
    headers,
    payload: JSON.stringify({
      templateId,
      parties: [{ role: "party_a", entityType: "organization", entityId: "x" }],
      ...(opts.strict !== undefined ? { strict: opts.strict } : {}),
    }),
  });
}

describe("POST /v1/documents", () => {
  it("renders a document with no placeholders", async () => {
    const tpl = await uploadTemplate();
    const res = await render(tpl.template.id);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.document.number).toBe("001-2026/TEST");
    expect(body.document.name).toBe("001-2026_TEST");
    expect(body.warnings).toEqual([]);
  });

  it("returns 422 on strict-mode resolution failure", async () => {
    // No resolver for party_z → NoResolverForScopeError
    rig.cfg.resolvers = [staticResolver("party_a", {})];

    // Build a template with a placeholder for party_z.
    const tpl = await uploadTemplate();
    // Wrap a placeholder pointing at party_z.
    await rig.app.inject({
      method: "POST",
      url: `/v1/templates/${tpl.template.id}/placeholders`,
      headers: { ...AUTH, "content-type": "application/json" },
      payload: JSON.stringify({
        location: {
          paraId: "AAAA0001",
          startRunIndex: 0,
          startOffset: 0,
          endRunIndex: 0,
          endOffset: 5,
        },
        placeholder: { tag: "party_z.k", alias: "X", dataType: "text" },
        expectedVersionId: tpl.template.currentVersionId,
      }),
    });
    const res = await render(tpl.template.id);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe("NO_RESOLVER_FOR_SCOPE");
  });

  it("Idempotency-Key returns cached result on second call", async () => {
    const tpl = await uploadTemplate();
    const key = randomUUID();
    const first = await render(tpl.template.id, { idempotencyKey: key });
    expect(first.statusCode).toBe(201);
    const firstDocId = JSON.parse(first.body).document.id;

    const second = await render(tpl.template.id, { idempotencyKey: key });
    expect(second.statusCode).toBe(200);
    const body = JSON.parse(second.body);
    expect(body.cached).toBe(true);
    expect(body.document.id).toBe(firstDocId);
  });
});

describe("GET /v1/documents", () => {
  it("lists owner's documents", async () => {
    const tpl = await uploadTemplate();
    await render(tpl.template.id);
    await render(tpl.template.id);
    const res = await rig.app.inject({
      method: "GET",
      url: "/v1/documents",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).documents).toHaveLength(2);
  });
});

describe("GET /v1/documents/:id", () => {
  it("serves docx blob with proper content-type", async () => {
    const tpl = await uploadTemplate();
    const doc = JSON.parse((await render(tpl.template.id)).body).document;
    const res = await rig.app.inject({
      method: "GET",
      url: `/v1/documents/${doc.id}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("wordprocessingml.document");
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it("returns 403 for other owners", async () => {
    rig.auth.allowedUsers.add("user-2");
    const tpl = await uploadTemplate();
    const doc = JSON.parse((await render(tpl.template.id)).body).document;
    const res = await rig.app.inject({
      method: "GET",
      url: `/v1/documents/${doc.id}`,
      headers: { "x-user-id": "user-2" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("rate limiter", () => {
  it("returns 429 after the configured per-minute limit", async () => {
    rig.cfg.rateLimitPerMinute = 2;
    const tpl = await uploadTemplate();
    // Build a fresh rig to pick up the new limit. (Limiter is created at
    // route registration; re-register via close+rebuild.)
    await rig.app.close();
    rig = await buildTestServer({ rateLimitPerMinute: 2 });
    const tpl2 = await uploadTemplate();

    const r1 = await render(tpl2.template.id);
    const r2 = await render(tpl2.template.id);
    const r3 = await render(tpl2.template.id);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r3.statusCode).toBe(429);
    // tpl is unused after rebuild; ensure the test isn't flaky on order.
    expect(tpl).toBeDefined();
  });
});
