/**
 * Render-pipeline-specific request and config types.
 *
 * Engine-public `RenderResult`, `RenderOptions`, `RenderWarning`, etc.
 * live in `../types.ts` because they appear on the public API surface
 * of the engine. The types here are render-internal plumbing.
 */

import type {
  EntityResolver,
  PartyRef,
  RenderOptions,
  RequisitesResolver,
  UserId,
} from "../types.js";

/**
 * Everything DocxRenderer.render needs to know about a single render
 * call. The host (server endpoint or fest-ops adapter) assembles this
 * after auth, number allocation, and party resolution.
 */
export interface RenderRequest {
  userId: UserId;
  templateId: string;
  templateVersionId: string;
  templateCategory: string | null;
  /** Pre-allocated document number — engine never allocates inside render. */
  documentNumber: string;
  /** N parties in role order. UI hosts may show only 2; engine supports any. */
  parties: PartyRef[];
  /** Wall-clock time injected for deterministic tests; defaults to `new Date()`. */
  now?: Date;
}

/**
 * Wiring that DocxRenderer needs at every render call. In a server-style
 * deployment this is built once at boot and reused across requests.
 */
export interface RenderConfig {
  /** Per-scope resolvers. Engine matches `resolver.scope` against tag scope. */
  resolvers: EntityResolver[];
  /** Block-level snippet provider for `requisites:*` tags. Used by Wave 6;
   *  Wave 5 surfaces a warning if a requisites tag is present without one. */
  requisitesResolver?: RequisitesResolver;
  /** Overrides for engine defaults (`strict` etc.). */
  options?: Partial<RenderOptions>;
}
