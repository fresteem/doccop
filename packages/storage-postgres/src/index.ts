/**
 * @doccop/storage-postgres — public surface.
 *
 * Drizzle-backed reference implementations of every `@doccop/server`
 * store interface plus a filesystem-backed `StorageAdapter` for the
 * demo. Hosts using this package wire their Drizzle handle into each
 * store constructor, then pass the stores to `DoccopServerConfig`.
 *
 * Example:
 *
 *   import { drizzle } from "drizzle-orm/postgres-js";
 *   import postgres from "postgres";
 *   import * as doccop from "@doccop/storage-postgres";
 *
 *   const sql = postgres(process.env.DATABASE_URL!);
 *   const db = drizzle(sql, { schema: doccop.schema });
 *
 *   const cfg: DoccopServerConfig = {
 *     templates: new doccop.PostgresTemplateStore(db),
 *     templateVersions: new doccop.PostgresTemplateVersionStore(db),
 *     ...
 *     storage: new doccop.FilesystemBlobStorage({ rootDir: "./blobs" }),
 *   };
 */

export * as schema from "./schema.js";
export type { Database } from "./db.js";

export { PostgresTemplateStore } from "./stores/PostgresTemplateStore.js";
export { PostgresTemplateVersionStore } from "./stores/PostgresTemplateVersionStore.js";
export { PostgresSnippetStore } from "./stores/PostgresSnippetStore.js";
export { PostgresSnippetVersionStore } from "./stores/PostgresSnippetVersionStore.js";
export { PostgresDocumentStore } from "./stores/PostgresDocumentStore.js";
export { PostgresIdempotencyStore } from "./stores/PostgresIdempotencyStore.js";
export { PostgresDataTypeRegistry } from "./stores/PostgresDataTypeRegistry.js";
export { FilesystemBlobStorage } from "./FilesystemBlobStorage.js";
export type { FilesystemBlobStorageOptions } from "./FilesystemBlobStorage.js";
