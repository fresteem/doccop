/**
 * Coverage targets:
 * - POST /v1/snippets: upload creates new snippet + v1
 * - POST /v1/snippets: second upload for same subtype upserts to v2
 * - POST /v1/snippets: 403 for users without manageSnippets
 * - GET /v1/snippets: lists all
 * - DELETE /v1/snippets/:id: 204 on success, 404 on miss
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestRig, buildTestServer, tinyDocxBytes } from "../helpers.js";

let rig: TestRig;
const AUTH = { "x-user-id": "user-1" };

beforeEach(async () => {
  rig = await buildTestServer();
});
afterEach(async () => {
  await rig.app.close();
});

async function uploadSnippet(entityType: string, entitySubtype: string, name: string) {
  const boundary = "----doccop-test";
  const file = tinyDocxBytes("reqs");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="meta"\r\n\r\n'),
    Buffer.from(`${JSON.stringify({ entityType, entitySubtype, name })}\r\n`),
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(
      'Content-Disposition: form-data; name="file"; filename="s.docx"\r\nContent-Type: application/octet-stream\r\n\r\n',
    ),
    Buffer.from(file),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return rig.app.inject({
    method: "POST",
    url: "/v1/snippets",
    headers: { ...AUTH, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
}

describe("POST /v1/snippets", () => {
  it("uploads a snippet as v1", async () => {
    const res = await uploadSnippet("organization", "TOV", "ТОВ requisites");
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.snippet.entitySubtype).toBe("TOV");
    expect(body.version.versionNumber).toBe(1);
  });

  it("upserts to v2 when (entityType, entitySubtype) match", async () => {
    await uploadSnippet("organization", "TOV", "v1");
    const second = await uploadSnippet("organization", "TOV", "v2");
    expect(second.statusCode).toBe(201);
    const body = JSON.parse(second.body);
    expect(body.snippet.name).toBe("v2");
    expect(body.version.versionNumber).toBe(2);
  });

  it("returns 403 for users without manageSnippets permission", async () => {
    rig.auth.manageSnippetsUsers.clear();
    const res = await uploadSnippet("organization", "FOP", "X");
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/snippets", () => {
  it("lists all snippets", async () => {
    await uploadSnippet("organization", "TOV", "T");
    await uploadSnippet("organization", "FOP", "F");
    const res = await rig.app.inject({
      method: "GET",
      url: "/v1/snippets",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).snippets).toHaveLength(2);
  });
});

describe("DELETE /v1/snippets/:id", () => {
  it("removes the snippet (204)", async () => {
    const created = JSON.parse((await uploadSnippet("organization", "PP", "P")).body);
    const res = await rig.app.inject({
      method: "DELETE",
      url: `/v1/snippets/${created.snippet.id}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(204);
  });

  it("returns 404 for unknown id", async () => {
    const res = await rig.app.inject({
      method: "DELETE",
      url: "/v1/snippets/no-such",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });
});
