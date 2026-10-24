/**
 * Apply pending migrations.
 *
 * Migrations run over a DIRECT (non-pooled) connection whenever one is
 * available: DDL inside a transaction-mode pooler is at best awkward and at
 * worst silently split across backend connections. `DIRECT_URL` is therefore
 * preferred, with `DATABASE_URL` as the fallback for environments that only
 * publish a single endpoint.
 *
 * Migration bookkeeping is kept inside the `gridbox` schema so nothing is
 * written outside the game's own namespace.
 *
 * Usage: DATABASE_URL=postgres://... npm run db:migrate
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../db/schema.js";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL and DATABASE_URL are both unset");
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false, ssl: "require" });
const db = drizzle(client, { schema });

try {
  await migrate(db, { migrationsFolder: "db/migrations", migrationsSchema: "gridbox" });
  console.log("migrations applied");
} catch (err) {
  console.error("migration failed:", err instanceof Error ? err.message : err);
  if (err && typeof err === "object" && "cause" in err) console.error("cause:", err.cause);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
