import { defineConfig } from "drizzle-kit";

/**
 * `DATABASE_URL` points at Supabase's transaction pooler (port 6543).
 *
 * This project's direct endpoint (`db.<ref>.supabase.co`) publishes an AAAA
 * record only — IPv6 is Supabase's default and IPv4 direct access is a paid
 * add-on. Vercel's Lambdas egress over IPv4, so the pooler is the only route
 * that actually works from production. `DIRECT_URL` is therefore optional and
 * only used when running migrations from a network that can reach IPv6;
 * otherwise migrations run through the pooler as well.
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
