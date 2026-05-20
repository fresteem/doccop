-- doccop Postgres reference schema (initial migration).
-- Mirrors @doccop/storage-postgres/src/schema.ts.
-- Run before any /v1/* endpoint sees production traffic.

CREATE TYPE doccop_visibility AS ENUM ('private', 'global');

CREATE TABLE doccop_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category_id text,
  owner_id text NOT NULL,
  visibility doccop_visibility NOT NULL DEFAULT 'private',
  current_version_id uuid,
  party_count integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doccop_templates_owner_idx ON doccop_templates (owner_id);
CREATE INDEX doccop_templates_visibility_idx ON doccop_templates (visibility);

CREATE TABLE doccop_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES doccop_templates(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  storage_path text NOT NULL,
  placeholders jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  change_summary text
);
CREATE UNIQUE INDEX doccop_template_versions_unique
  ON doccop_template_versions (template_id, version_number);

CREATE TABLE doccop_snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_subtype text NOT NULL,
  name text NOT NULL,
  owner_id text NOT NULL,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX doccop_snippets_subtype_unique
  ON doccop_snippets (entity_type, entity_subtype);

CREATE TABLE doccop_snippet_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snippet_id uuid NOT NULL REFERENCES doccop_snippets(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  storage_path text NOT NULL,
  placeholders jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL
);
CREATE UNIQUE INDEX doccop_snippet_versions_unique
  ON doccop_snippet_versions (snippet_id, version_number);

CREATE TABLE doccop_generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES doccop_templates(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES doccop_template_versions(id) ON DELETE RESTRICT,
  parties jsonb NOT NULL,
  variables_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  number text NOT NULL,
  name text NOT NULL,
  storage_path text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL
);
CREATE INDEX doccop_generated_documents_owner_created_idx
  ON doccop_generated_documents (created_by, created_at DESC);
CREATE UNIQUE INDEX doccop_generated_documents_owner_number_unique
  ON doccop_generated_documents (created_by, number);

CREATE TABLE doccop_idempotency (
  key text NOT NULL,
  user_id text NOT NULL,
  generated_document_id uuid NOT NULL REFERENCES doccop_generated_documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX doccop_idempotency_pk ON doccop_idempotency (key, user_id);
CREATE INDEX doccop_idempotency_created_idx ON doccop_idempotency (created_at);

CREATE TABLE doccop_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  scope text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL,
  default_value text,
  source_path text,
  owner_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX doccop_variables_key_scope_unique ON doccop_variables (key, scope);
