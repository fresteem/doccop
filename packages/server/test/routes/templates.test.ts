/**
 * Coverage targets:
 * - 401 without auth header
 * - POST /v1/templates: upload .docx, returns 201 + template + version
 * - POST /v1/templates: rejects oversized payload (size limit)
 * - GET /v1/templates: lists owner's + global templates
 * - GET /v1/templates/:id: returns metadata
 * - GET /v1/templates/:id/preview: returns HTML + anchors
 * - POST /v1/templates/:id/placeholders: wraps, new version returned
 * - POST /v1/templates/:id/placeholders: rejects on version conflict
 * - DELETE /v1/templates/:id/placeholders/:tag: unwraps
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestRig, buildTestServer, tinyDocxBytes } from "../helpers.js";

let rig: TestRig;

beforeEach(async () => {
  rig = await buildTestServer();
});
afterEach(async () => {
  await rig.app.close();
});

const AUTH_HEADER = { "x-user-id": "user-1" };

async function uploadTemplate(name = "T", text = "Hello") {
  const boundary = "----doccop-test";
  const file = tinyDocxBytes(text);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="meta"\r\n\r\n'),
    Buffer.from(`${JSON.stringify({ name })}\r\n`),
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(
      'Content-Disposition: form-data; name="file"; filename="t.docx"\r\nContent-Type: application/octet-stream\r\n\r\n',
    ),
    Buffer.from(file),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return rig.app.inject({
    method: "POST",
    url: "/v1/templates",
    headers: {
      ...AUTH_HEADER,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

describe("auth", () => {
  it("returns 401 when no x-user-id header", async () => {
    const res = await rig.app.inject({ method: "GET", url: "/v1/templates" });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("UNAUTHENTICATED");
  });
});

describe("POST /v1/templates", () => {
  it("uploads a .docx and creates v1", async () => {
    const res = await uploadTemplate("My Tpl");
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.template).toMatchObject({ name: "My Tpl", visibility: "private" });
    expect(body.version.versionNumber).toBe(1);
    expect(body.template.currentVersionId).toBe(body.version.id);
  });

  it("rejects oversized payload", async () => {
    rig.cfg.maxUploadBytes = 100;
    const res = await uploadTemplate("Huge", "x".repeat(10_000));
    expect([400, 413]).toContain(res.statusCode);
  });

  it("persists ownership", async () => {
    const res = await uploadTemplate("Ownership");
    const body = JSON.parse(res.body);
    expect(body.template.ownerId).toBe("user-1");
  });
});

describe("GET /v1/templates", () => {
  it("lists owner's templates", async () => {
    await uploadTemplate("A");
    await uploadTemplate("B");
    const res = await rig.app.inject({
      method: "GET",
      url: "/v1/templates",
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.templates).toHaveLength(2);
  });
});

describe("GET /v1/templates/:id", () => {
  it("returns metadata", async () => {
    const created = JSON.parse((await uploadTemplate("X")).body);
    const res = await rig.app.inject({
      method: "GET",
      url: `/v1/templates/${created.template.id}`,
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).template.id).toBe(created.template.id);
  });

  it("returns 404 for unknown id", async () => {
    const res = await rig.app.inject({
      method: "GET",
      url: "/v1/templates/no-such",
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/templates/:id/preview", () => {
  it("returns HTML preview + anchors", async () => {
    const created = JSON.parse((await uploadTemplate("Prev", "Preview text")).body);
    const res = await rig.app.inject({
      method: "GET",
      url: `/v1/templates/${created.template.id}/preview`,
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.html).toContain("Preview text");
    expect(body.anchors.paragraphs).toBeDefined();
  });
});

describe("POST /v1/templates/:id/placeholders (wrap)", () => {
  it("wraps a selection and creates v2", async () => {
    const created = JSON.parse((await uploadTemplate("W", "Hello world")).body);
    const res = await rig.app.inject({
      method: "POST",
      url: `/v1/templates/${created.template.id}/placeholders`,
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: JSON.stringify({
        location: {
          paraId: "AAAA0001",
          startRunIndex: 0,
          startOffset: 6,
          endRunIndex: 0,
          endOffset: 11,
        },
        placeholder: {
          tag: "party_a.full_name",
          alias: "Name",
          dataType: "text",
        },
        expectedVersionId: created.template.currentVersionId,
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.version.versionNumber).toBe(2);
    expect(body.template.currentVersionId).toBe(body.version.id);
  });

  it("rejects when expectedVersionId is stale (409)", async () => {
    const created = JSON.parse((await uploadTemplate("WC", "Hello world")).body);
    const res = await rig.app.inject({
      method: "POST",
      url: `/v1/templates/${created.template.id}/placeholders`,
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: JSON.stringify({
        location: {
          paraId: "AAAA0001",
          startRunIndex: 0,
          startOffset: 0,
          endRunIndex: 0,
          endOffset: 5,
        },
        placeholder: { tag: "party_a.k", alias: "A", dataType: "text" },
        expectedVersionId: "obviously-not-the-current-id",
      }),
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("DELETE /v1/templates/:id/placeholders/:tag", () => {
  it("unwraps the placeholder and creates v3", async () => {
    const created = JSON.parse((await uploadTemplate("UW", "Hello world")).body);
    // First wrap.
    const wrapRes = JSON.parse(
      (
        await rig.app.inject({
          method: "POST",
          url: `/v1/templates/${created.template.id}/placeholders`,
          headers: { ...AUTH_HEADER, "content-type": "application/json" },
          payload: JSON.stringify({
            location: {
              paraId: "AAAA0001",
              startRunIndex: 0,
              startOffset: 0,
              endRunIndex: 0,
              endOffset: 5,
            },
            placeholder: { tag: "party_a.k", alias: "A", dataType: "text" },
            expectedVersionId: created.template.currentVersionId,
          }),
        })
      ).body,
    );
    // Then unwrap.
    const res = await rig.app.inject({
      method: "DELETE",
      url: `/v1/templates/${wrapRes.template.id}/placeholders/party_a.k`,
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).version.versionNumber).toBe(3);
  });
});

describe("POST /v1/templates/:id/placeholders (wrapBlock)", () => {
  it("wraps a single-paragraph block range and creates v2", async () => {
    const created = JSON.parse((await uploadTemplate("WB", "Block body")).body);
    const res = await rig.app.inject({
      method: "POST",
      url: `/v1/templates/${created.template.id}/placeholders`,
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: JSON.stringify({
        blockRange: { startParaId: "AAAA0001", endParaId: "AAAA0001" },
        placeholder: {
          tag: "requisites:party_a",
          alias: "Реквізити А",
          dataType: "text",
        },
        expectedVersionId: created.template.currentVersionId,
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.version.versionNumber).toBe(2);
    expect(body.version.placeholders).toHaveLength(1);
    expect(body.version.placeholders[0].tag).toBe("requisites:party_a");
  });

  it("rejects when both `location` and `blockRange` are provided (400)", async () => {
    const created = JSON.parse((await uploadTemplate("WB2", "x")).body);
    const res = await rig.app.inject({
      method: "POST",
      url: `/v1/templates/${created.template.id}/placeholders`,
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: JSON.stringify({
        location: {
          paraId: "AAAA0001",
          startRunIndex: 0,
          startOffset: 0,
          endRunIndex: 0,
          endOffset: 1,
        },
        blockRange: { startParaId: "AAAA0001", endParaId: "AAAA0001" },
        placeholder: { tag: "requisites:party_a", alias: "R", dataType: "text" },
        expectedVersionId: created.template.currentVersionId,
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("INVALID_PLACEHOLDER_TAG");
  });

  it("rejects when neither `location` nor `blockRange` is provided (400)", async () => {
    const created = JSON.parse((await uploadTemplate("WB3", "x")).body);
    const res = await rig.app.inject({
      method: "POST",
      url: `/v1/templates/${created.template.id}/placeholders`,
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: JSON.stringify({
        placeholder: { tag: "requisites:party_a", alias: "R", dataType: "text" },
        expectedVersionId: created.template.currentVersionId,
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("INVALID_PLACEHOLDER_TAG");
  });

  it("rejects blockRange with a non-requisites tag (400)", async () => {
    const created = JSON.parse((await uploadTemplate("WB4", "x")).body);
    const res = await rig.app.inject({
      method: "POST",
      url: `/v1/templates/${created.template.id}/placeholders`,
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: JSON.stringify({
        blockRange: { startParaId: "AAAA0001", endParaId: "AAAA0001" },
        placeholder: { tag: "party_a.full_name", alias: "Name", dataType: "text" },
        expectedVersionId: created.template.currentVersionId,
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("INVALID_PLACEHOLDER_TAG");
  });
});
