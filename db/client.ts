import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Serverless-safe connection singleton.
 *
 * Vercel reuses the module scope across warm invocations, so caching the pool
 * avoids exhausting Supabase's connection limit. `max: 1` is deliberate: each
 * lambda needs one connection, and Supabase's pooler does the multiplexing.
 */
let cached: { db: Database; url: string } | null = null;

export function createDatabase(connectionString: string): Database {
  if (cached?.url === connectionString) return cached.db;

  const client = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // Supabase's transaction pooler does not support prepared statements.
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
