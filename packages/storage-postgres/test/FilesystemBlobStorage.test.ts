/**
 * Coverage targets:
 * - save/load round-trip
 * - paths are namespaced by owner + type
 * - paths sanitise unsafe owner-id chars
 * - signedUrl returns a file:// URL under the root
 * - read of unknown path throws StorageFailedError
 * - path traversal attempt is rejected
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageFailedError } from "@doccop/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemBlobStorage } from "../src/FilesystemBlobStorage.js";

let dir: string;
let store: FilesystemBlobStorage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "doccop-fs-"));
  store = new FilesystemBlobStorage({ rootDir: dir });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("FilesystemBlobStorage", () => {
  it("round-trips template bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const path = await store.saveTemplate(bytes, "user-1");
    expect(path).toMatch(/^templates\/user-1\//);
    const back = await store.loadTemplate(path);
    expect(back).toEqual(bytes);
  });

  it("round-trips document bytes via hint.ownerId", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const path = await store.saveDocument(bytes, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ownerId: "user-2",
    });
    expect(path).toMatch(/^documents\/user-2\//);
    expect(await store.loadDocument(path)).toEqual(bytes);
  });

  it("round-trips snippet bytes", async () => {
    const bytes = new Uint8Array([10]);
    const path = await store.saveSnippet(bytes, "admin");
    expect(path).toMatch(/^snippets\/admin\//);
    expect(await store.loadSnippet(path)).toEqual(bytes);
  });

  it("sanitises owner ids with path separators", async () => {
    const bytes = new Uint8Array([1]);
    const path = await store.saveTemplate(bytes, "../evil/user");
    // "../evil/user" → 3 unsafe chars (`.`, `.`, `/`) + `evil` + `_` + `user`.
    expect(path).toMatch(/^templates\/___evil_user\//);
    expect(await store.loadTemplate(path)).toEqual(bytes);
  });

  it("signedUrl returns a file:// URL", async () => {
    const url = await store.signedUrl("templates/u/abc.docx");
    expect(url).toMatch(/^file:\/\//);
    expect(url).toContain("templates/u/abc.docx");
  });

  it("read of unknown path throws StorageFailedError", async () => {
    await expect(store.loadTemplate("nope/no/here.docx")).rejects.toBeInstanceOf(
      StorageFailedError,
    );
  });

  it("rejects path-traversal attempts", async () => {
    await expect(store.loadTemplate("../../../etc/passwd")).rejects.toBeInstanceOf(
      StorageFailedError,
    );
  });
});
