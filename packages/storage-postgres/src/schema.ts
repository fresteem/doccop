/**
 * Drizzle ORM schema for the doccop Postgres reference implementation.
 *
 * Mirrors the store interfaces declared in `@doccop/server/types`. Hosts
 * embedding the engine can use this schema directly OR keep their own
 * tables and implement the store interfaces over them.
 *
 * Conventions:
 * - Primary keys are `uuid` with `defaultRandom()` so callers don't
 *   need to generate them.
 * - Timestamps use `timestamptz` so client and server agree on the
 *   instant regardless of session timezone.
 * - JSONB columns hold structured engine types (placeholders,
 *   variables snapshot, parties array).
 * - All FKs ON DELETE behaviour: documents → templates RESTRICT (can't
 *   delete a template that has rendered docs); template_versions →
 *   templates CASCADE (deleting a template wipes its history).
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ─────────────────────────────────────────────────────────────────

export const visibilityEnum = pgEnum("doccop_visibility", ["private", "global"]);

// ─── Tables ────────────────────────────────────────────────────────────────

export const templates = pgTable(
  "doccop_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: text("category_id"),
    ownerId: text("owner_id").notNull(),
    visibility: visibilityEnum("visibility").notNull().default("private"),
    currentVersionId: uuid("current_version_id"),
    partyCount: integer("party_count").notNull().default(2),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    ownerIdx: index("doccop_templates_owner_idx").on(t.ownerId),
    visibilityIdx: index("doccop_templates_visibility_idx").on(t.visibility),
  }),
);

export const templateVersions = pgTable(
  "doccop_template_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    storagePath: text("storage_path").notNull(),
    placeholders: jsonb("placeholders").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdBy: text("created_by").notNull(),
    changeSummary: text("change_summary"),
  },
  (t) => ({
    templateVersionUnique: uniqueIndex("doccop_template_versions_unique").on(
      t.templateId,
      t.versionNumber,
    ),
  }),
);

export const snippets = pgTable(
  "doccop_snippets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entitySubtype: text("entity_subtype").notNull(),
    name: text("name").notNull(),
    ownerId: text("owner_id").notNull(),
    currentVersionId: uuid("current_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    subtypeUnique: uniqueIndex("doccop_snippets_subtype_unique").on(t.entityType, t.entitySubtype),
  }),
);

export const snippetVersions = pgTable(
  "doccop_snippet_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snippetId: uuid("snippet_id")
      .notNull()
      .references(() => snippets.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    storagePath: text("storage_path").notNull(),
    placeholders: jsonb("placeholders").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdBy: text("created_by").notNull(),
  },
  (t) => ({
    snippetVersionUnique: uniqueIndex("doccop_snippet_versions_unique").on(
      t.snippetId,
      t.versionNumber,
    ),
  }),
);

export const generatedDocuments = pgTable(
  "doccop_generated_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "restrict" }),
    templateVersionId: uuid("template_version_id")
      .notNull()
      .references(() => templateVersions.id, { onDelete: "restrict" }),
    parties: jsonb("parties").notNull(),
    variablesSnapshot: jsonb("variables_snapshot").notNull().default({}),
    number: text("number").notNull(),
    name: text("name").notNull(),
    storagePath: text("storage_path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdBy: text("created_by").notNull(),
  },
  (t) => ({
    ownerCreatedIdx: index("doccop_generated_documents_owner_created_idx").on(
      t.createdBy,
      t.createdAt,
    ),
    ownerNumberUnique: uniqueIndex("doccop_generated_documents_owner_number_unique").on(
      t.createdBy,
      t.number,
    ),
  }),
);

export const idempotency = pgTable(
  "doccop_idempotency",
  {
    key: text("key").notNull(),
    userId: text("user_id").notNull(),
    generatedDocumentId: uuid("generated_document_id")
      .notNull()
      .references(() => generatedDocuments.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: uniqueIndex("doccop_idempotency_pk").on(t.key, t.userId),
    createdIdx: index("doccop_idempotency_created_idx").on(t.createdAt),
  }),
);

export const variables = pgTable(
  "doccop_variables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    label: text("label").notNull(),
    dataType: text("data_type").notNull(),
    defaultValue: text("default_value"),
    sourcePath: text("source_path"),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    keyScopeUnique: uniqueIndex("doccop_variables_key_scope_unique").on(t.key, t.scope),
  }),
);

// ─── Drizzle inferred types (consumed by store impls) ──────────────────────

export type TemplateRow = typeof templates.$inferSelect;
export type NewTemplateRow = typeof templates.$inferInsert;
export type TemplateVersionRow = typeof templateVersions.$inferSelect;
export type NewTemplateVersionRow = typeof templateVersions.$inferInsert;
export type SnippetRow = typeof snippets.$inferSelect;
export type NewSnippetRow = typeof snippets.$inferInsert;
export type SnippetVersionRow = typeof snippetVersions.$inferSelect;
export type NewSnippetVersionRow = typeof snippetVersions.$inferInsert;
export type GeneratedDocumentRow = typeof generatedDocuments.$inferSelect;
export type NewGeneratedDocumentRow = typeof generatedDocuments.$inferInsert;
export type IdempotencyRow = typeof idempotency.$inferSelect;
export type VariableRow = typeof variables.$inferSelect;
