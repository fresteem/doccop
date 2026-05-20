/**
 * Drizzle database handle type alias.
 *
 * Hosts pass their own `drizzle({ schema })` instance into each store
 * constructor. The package never opens its own connection — that's the
 * host's responsibility (pool config, TLS, etc.).
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;
