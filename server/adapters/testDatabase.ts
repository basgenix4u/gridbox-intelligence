import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "../../db/schema.js";

/**
 * A real Postgres for the integration tests, in-process.
 *
 * PGlite is Postgres compiled to WASM: same SQL engine, same error codes, no
 * server, no Docker, no network — which is what lets the drizzle adapters be
 * tested against actual SQL (composite-key upserts, DISTINCT ON, window
 * functions, held-name exclusion, FK cascades) in CI and on a laptop.
 *
 * The schema is built by replaying the project's own migration files, so a
 * drift between `db/schema.ts` and the migrations fails here first. Only the
 * data migrations (0000, 0002) are applied: 0001 is Row Level Security, which
 * needs roles that exist on the server, not in a test.
 */

const MIGRATIONS = ["0000_init.sql", "0002_graceful_firestar.sql", "0003_lumpy_the_hunter.sql"] as const;

/**
 * The schema namespace comes from `db/bootstrap.sql` (creating a schema needs
 * privileges the migrations deliberately do not have); everything else is
 * replayed from the migration files themselves.
 */
function migrationSql(): string {
  const dir = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
  const bootstrap = 'CREATE SCHEMA IF NOT EXISTS "gridbox";';
  return [bootstrap, ...MIGRATIONS.map((name) => readFileSync(`${dir}${name}`, "utf8"))].join("\n");
}

/** Splits a drizzle migration file into executable statements. */
function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
}

export interface TestDatabase {
  db: PgliteDatabase<typeof schema>;
  /** Wipes every table so each test starts from a known state. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Boots a fresh PGlite with the gridbox schema applied. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  for (const statement of statements(migrationSql())) {
    await client.exec(statement);
  }

  return {
    db,
    async reset() {
      await client.exec(
        'TRUNCATE "gridbox"."runs", "gridbox"."name_reports", "gridbox"."leaderboard_daily", "gridbox"."players", "gridbox"."audit_log" RESTART IDENTITY CASCADE',
      );
    },
    async close() {
      await client.close();
    },
  };
}
