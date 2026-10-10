/**
 * Apply pending migrations.
 *
 * Runs through the same postgres.js client the application uses, over the
 * transaction pooler. This project's direct endpoint is IPv6-only, so the
 * pooler is the only route available from CI, Vercel and this workspace.
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

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
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
