/**
 * Postgres reference impl of `DataTypeRegistry`.
 *
 * Reads `doccop_variables.data_type` keyed by `<scope>.<key>` for every
 * known placeholder. `snapshot()` returns the full map for one-shot
 * render passes; `forTag` lookups go straight to the row for ad-hoc
 * validators.
 */

import type { DataType } from "@doccop/core";
import type { DataTypeRegistry } from "@doccop/server/types";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db.js";
import { variables } from "../schema.js";

const VALID_TYPES = new Set<DataType>([
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

export class PostgresDataTypeRegistry implements DataTypeRegistry {
  constructor(private readonly db: Database) {}

  async forTag(tag: string): Promise<DataType | null> {
    const dot = tag.indexOf(".");
    if (dot < 0) return null;
    const scope = tag.slice(0, dot);
    const key = tag.slice(dot + 1);
    const rows = await this.db
      .select({ dataType: variables.dataType })
      .from(variables)
      .where(and(eq(variables.scope, scope), eq(variables.key, key)))
      .limit(1);
    const dt = rows[0]?.dataType;
    return dt && VALID_TYPES.has(dt as DataType) ? (dt as DataType) : null;
  }

  async snapshot(): Promise<ReadonlyMap<string, DataType>> {
    const rows = await this.db
      .select({ key: variables.key, scope: variables.scope, dataType: variables.dataType })
      .from(variables);
    const map = new Map<string, DataType>();
    for (const r of rows) {
      if (!VALID_TYPES.has(r.dataType as DataType)) continue;
      map.set(`${r.scope}.${r.key}`, r.dataType as DataType);
    }
    return map;
  }

  /**
   * Convenience helper exposed by this impl (not part of the
   * `DataTypeRegistry` interface). Lets seed scripts populate the
   * table from a static list.
   */
  async seed(
    rows: Array<{
      key: string;
      scope: string;
      label: string;
      dataType: DataType;
      defaultValue?: string | null;
      sourcePath?: string | null;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(variables)
      .values(
        rows.map((r) => ({
          key: r.key,
          scope: r.scope,
          label: r.label,
          dataType: r.dataType,
          defaultValue: r.defaultValue ?? null,
          sourcePath: r.sourcePath ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [variables.key, variables.scope],
        set: {
          label: sql`excluded.label`,
          dataType: sql`excluded.data_type`,
          defaultValue: sql`excluded.default_value`,
          sourcePath: sql`excluded.source_path`,
        },
      });
  }
}
