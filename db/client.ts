import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Serverless-safe connection singleton.
 *
 * Vercel reuses the module scope across warm invocations, so caching the pool
 * avoids reconnecting on every request. `max: 1` is deliberate: each function
 * instance needs one connection, and Neon's pooler does the multiplexing.
 */
let cached: { db: Database; url: string } | null = null;

export function createDatabase(connectionString: string): Database {
  if (cached?.url === connectionString) return cached.db;

  const client = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // Neon's transaction pooler does not support prepared statements.
    prepare: false,
    ssl: connectionString.includes("localhost") ? undefined : "require",
  });

  const db = drizzle(client, { schema });
  cached = { db, url: connectionString };
  return db;
}

/** Test seam: forget the cached connection. */
export function resetDatabaseCache(): void {
  cached = null;
}
