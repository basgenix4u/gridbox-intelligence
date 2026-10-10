import { defineConfig } from "drizzle-kit";

/**
 * `DATABASE_URL` must point at Supabase's *transaction pooler* (port 6543).
 * Migrations use `DIRECT_URL` (port 5432) because DDL cannot run through the
 * pooler in transaction mode.
 */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "postgresql://localhost:5432/gridbox",
  },
  strict: true,
  verbose: true,
});
