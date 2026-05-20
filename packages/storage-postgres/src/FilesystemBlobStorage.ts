/**
 * Filesystem-backed `StorageAdapter`.
 *
 * Reference implementation for the OSS demo app — stores docx blobs
 * on disk under a configured root directory. Production hosts should
 * use a real object store (S3, GCS, Supabase Storage); this impl
 * exists so the demo can run with zero infra.
 *
 * Files are organised by owner/type for easy human inspection:
 *
 *   <root>/templates/<owner>/<uuid>.docx
 *   <root>/documents/<owner>/<uuid>.docx
 *   <root>/snippets/<owner>/<uuid>.docx
 *
 * `signedUrl` returns a `file://` URL — not actually signed, but the
 * server only uses it for client redirects when one is present.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type SaveDocumentHint,
  type StorageAdapter,
  StorageFailedError,
  type UserId,
} from "@doccop/core";

export interface FilesystemBlobStorageOptions {
  /** Absolute path. The directory is created on demand. */
  rootDir: string;
}

export class FilesystemBlobStorage implements StorageAdapter {
  private readonly root: string;
  constructor(opts: FilesystemBlobStorageOptions) {
    this.root = resolve(opts.rootDir);
  }

  async saveTemplate(bytes: Uint8Array, ownerId: UserId): Promise<string> {
    return this.writeUnder("templates", ownerId, bytes);
  }
  async loadTemplate(path: string): Promise<Uint8Array> {
    return this.readSafe(path);
  }
  async saveDocument(bytes: Uint8Array, hint: SaveDocumentHint): Promise<string> {
    return this.writeUnder("documents", hint.ownerId, bytes);
  }
  async loadDocument(path: string): Promise<Uint8Array> {
    return this.readSafe(path);
  }
  async saveSnippet(bytes: Uint8Array, ownerId: UserId): Promise<string> {
    return this.writeUnder("snippets", ownerId, bytes);
  }
  async loadSnippet(path: string): Promise<Uint8Array> {
    return this.readSafe(path);
  }
  async signedUrl(path: string): Promise<string> {
    return `file://${join(this.root, path)}`;
  }

  // ─── internals ───────────────────────────────────────────────────────

  private async writeUnder(prefix: string, ownerId: UserId, bytes: Uint8Array): Promise<string> {
    // Sanitise ownerId — strip path separators and `..` to be extra
    // defensive even though the API contract limits ownerId shape.
    const safeOwner = ownerId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const id = randomUUID();
    const relPath = `${prefix}/${safeOwner}/${id}.docx`;
    const fullPath = this.resolveSafe(relPath);
    try {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, bytes);
    } catch (err) {
      throw new StorageFailedError(`write ${relPath}`, err);
    }
    return relPath;
  }

  private async readSafe(path: string): Promise<Uint8Array> {
    const fullPath = this.resolveSafe(path);
    try {
      const buf = await readFile(fullPath);
      return new Uint8Array(buf);
    } catch (err) {
      throw new StorageFailedError(`read ${path}`, err);
    }
  }

  /**
   * Resolve a path against `root` and refuse to leave the root via
   * `..` segments. This is a defensive check — the engine controls all
   * paths handed back, but an adversarial host could pass anything.
   */
  private resolveSafe(relPath: string): string {
    const full = resolve(this.root, relPath);
    if (!full.startsWith(`${this.root}/`) && full !== this.root) {
      throw new StorageFailedError(`path traversal: ${relPath}`, null);
    }
    return full;
  }
}
