/**
 * Coverage targets:
 * - Date → ISO conversion for createdAt/updatedAt
 * - jsonb → typed structures (placeholders, parties, variablesSnapshot)
 * - nullable columns survive the mapping
 */

import { describe, expect, it } from "vitest";
import {
  documentRowToRecord,
  snippetRowToRecord,
  snippetVersionRowToRecord,
  templateRowToRecord,
  templateVersionRowToRecord,
} from "../src/row-mappers.js";

describe("templateRowToRecord", () => {
  it("converts Date columns to ISO strings", () => {
    const now = new Date("2026-05-20T12:00:00Z");
    const rec = templateRowToRecord({
      id: "t-1",
      name: "T",
      description: null,
      categoryId: null,
      ownerId: "u-1",
      visibility: "private",
      currentVersionId: null,
      partyCount: 2,
      createdAt: now,
      updatedAt: now,
    });
    expect(rec.createdAt).toBe("2026-05-20T12:00:00.000Z");
    expect(rec.updatedAt).toBe("2026-05-20T12:00:00.000Z");
  });

  it("passes nullable fields through unchanged", () => {
    const rec = templateRowToRecord({
      id: "t-1",
      name: "T",
      description: "desc",
      categoryId: "cat-1",
      ownerId: "u-1",
      visibility: "global",
      currentVersionId: "v-1",
      partyCount: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(rec.description).toBe("desc");
    expect(rec.categoryId).toBe("cat-1");
    expect(rec.currentVersionId).toBe("v-1");
    expect(rec.partyCount).toBe(3);
    expect(rec.visibility).toBe("global");
  });
});

describe("templateVersionRowToRecord", () => {
  it("treats null placeholders as an empty array", () => {
    const rec = templateVersionRowToRecord({
      id: "v-1",
      templateId: "t-1",
      versionNumber: 1,
      storagePath: "p",
      placeholders: null as unknown as never,
      createdAt: new Date(),
      createdBy: "u-1",
      changeSummary: null,
    });
    expect(rec.placeholders).toEqual([]);
  });

  it("preserves placeholder array shape", () => {
    const placeholders = [
      {
        tag: "party_a.full_name",
        alias: "Name",
        scope: "party_a" as const,
        key: "full_name",
        dataType: "text" as const,
        paraId: "AAAAAAAA",
      },
    ];
    const rec = templateVersionRowToRecord({
      id: "v-1",
      templateId: "t-1",
      versionNumber: 1,
      storagePath: "p",
      placeholders: placeholders as unknown,
      createdAt: new Date(),
      createdBy: "u-1",
      changeSummary: "init",
    });
    expect(rec.placeholders).toEqual(placeholders);
    expect(rec.changeSummary).toBe("init");
  });
});

describe("snippetRowToRecord / snippetVersionRowToRecord", () => {
  it("maps snippet fields", () => {
    const rec = snippetRowToRecord({
      id: "s-1",
      entityType: "organization",
      entitySubtype: "TOV",
      name: "ТОВ requisites",
      ownerId: "admin",
      currentVersionId: "sv-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(rec.entitySubtype).toBe("TOV");
    expect(rec.currentVersionId).toBe("sv-1");
  });

  it("maps snippet versions", () => {
    const rec = snippetVersionRowToRecord({
      id: "sv-1",
      snippetId: "s-1",
      versionNumber: 2,
      storagePath: "p",
      placeholders: [],
      createdAt: new Date(),
      createdBy: "admin",
    });
    expect(rec.versionNumber).toBe(2);
  });
});

describe("documentRowToRecord", () => {
  it("casts jsonb columns to typed shapes", () => {
    const rec = documentRowToRecord({
      id: "d-1",
      templateId: "t-1",
      templateVersionId: "v-1",
      parties: [{ role: "party_a", entityType: "organization", entityId: "x" }] as unknown,
      variablesSnapshot: { "party_a.full_name": "ACME" } as unknown,
      number: "001-2026/TEST",
      name: "001-2026_TEST",
      storagePath: "p",
      sizeBytes: 1024,
      createdAt: new Date(),
      createdBy: "u-1",
    });
    expect(rec.parties[0]?.role).toBe("party_a");
    expect(rec.variablesSnapshot["party_a.full_name"]).toBe("ACME");
    expect(rec.sizeBytes).toBe(1024);
  });

  it("defaults missing variablesSnapshot to {}", () => {
    const rec = documentRowToRecord({
      id: "d-1",
      templateId: "t-1",
      templateVersionId: "v-1",
      parties: [] as unknown,
      variablesSnapshot: null as unknown as never,
      number: "1",
      name: "n",
      storagePath: "p",
      sizeBytes: 0,
      createdAt: new Date(),
      createdBy: "u-1",
    });
    expect(rec.variablesSnapshot).toEqual({});
  });
});
