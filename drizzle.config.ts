import { defineConfig } from "drizzle-kit";

/**
 * `DATABASE_URL` points at Neon's connection pooler.
 *
 * The pooler is what the runtime uses: Vercel's functions are short-lived and
 * numerous, so a pooler in front of the compute is what keeps the connection
 * count sane. `DIRECT_URL` is the non-pooled endpoint and is preferred for
 * migrations, because DDL inside a transaction-mode pooler is at best awkward
 * and at worst silently split across backend connections.
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
