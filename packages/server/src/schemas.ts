/**
 * Zod schemas for request bodies + URL parameters.
 *
 * Every endpoint validates input through Zod before the engine touches
 * it — type-checking the boundary keeps malformed payloads from
 * reaching the parser / renderer.
 */

import { z } from "zod";

const TagSchema = z.string().min(1).max(100);
const AliasSchema = z.string().min(1).max(200);

export const DataTypeSchema = z.enum([
  "text",
  "number",
  "integer",
  "date",
  "boolean",
  "edrpou",
  "rnokpp",
  "iban",
  "email",
  "phone",
]);

export const TemplateUploadSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  categoryId: z.string().optional(),
  visibility: z.enum(["private", "global"]).default("private"),
  partyCount: z.number().int().min(1).max(10).default(2),
});

export const TemplateIdParamSchema = z.object({
  id: z.string().min(1),
});

export const PlaceholderWrapSchema = z.object({
  /**
   * Inline wrap location. Mutually exclusive with `blockRange`; exactly
   * one of the two must be present (enforced in the route handler).
   */
  location: z
    .object({
      paraId: z.string().regex(/^[0-9A-F]{8}$/),
      startRunIndex: z.number().int().min(0),
      startOffset: z.number().int().min(0),
      endRunIndex: z.number().int().min(0),
      endOffset: z.number().int().min(0),
    })
    .optional(),
  /**
   * Inclusive paragraph range to wrap as a block-level SDT. Mutually
   * exclusive with `location`. Requires `placeholder.tag` of the
   * `requisites:party_<id>` form.
   */
  blockRange: z
    .object({
      startParaId: z.string().regex(/^[0-9A-F]{8}$/),
      endParaId: z.string().regex(/^[0-9A-F]{8}$/),
    })
    .optional(),
  placeholder: z.object({
    tag: TagSchema,
    alias: AliasSchema,
    dataType: DataTypeSchema,
  }),
  /** Expected current template-version id for optimistic concurrency. */
  expectedVersionId: z.string().nullable().optional(),
  /** Optional change summary persisted with the new version row. */
  changeSummary: z.string().max(500).optional(),
});

export const PlaceholderTagParamSchema = z.object({
  id: z.string().min(1),
  tag: TagSchema,
});

export const SnippetUploadSchema = z.object({
  entityType: z.string().min(1).max(50),
  entitySubtype: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
});

export const SnippetIdParamSchema = z.object({
  id: z.string().min(1),
});

export const PartySchema = z.object({
  role: z.string().regex(/^(party_[a-z0-9_]+|system|custom)$/),
  entityType: z.string().min(1).max(50),
  entityId: z.string().min(1).max(200),
});

export const DocumentRenderSchema = z.object({
  templateId: z.string().min(1),
  parties: z.array(PartySchema).min(1).max(10),
  /** Per-request override of `config.strictRender`. */
  strict: z.boolean().optional(),
});

export const DocumentIdParamSchema = z.object({
  id: z.string().min(1),
});

export type TemplateUploadInput = z.infer<typeof TemplateUploadSchema>;
export type PlaceholderWrapInput = z.infer<typeof PlaceholderWrapSchema>;
export type SnippetUploadInput = z.infer<typeof SnippetUploadSchema>;
export type DocumentRenderInput = z.infer<typeof DocumentRenderSchema>;
