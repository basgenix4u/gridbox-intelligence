import { z } from "zod";

/**
 * Server-side environment contract.
 *
 * Validated once at cold start so a misconfigured deployment fails fast with a
 * readable message instead of throwing somewhere deep in a request handler.
 * Secrets are read only here and never returned to a client.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Supabase transaction pooler (port 6543). Optional so health checks work with no DB. */
  DATABASE_URL: z.string().url().optional(),
  /** Direct connection (port 5432). Used by migrations only. */
  DIRECT_URL: z.string().url().optional(),
  /** HS256 signing key for anonymous session tokens. */
  AUTH_SECRET: z.string().min(32).optional(),
  /** Owner token guarding the moderation admin endpoints. */
  MODERATION_TOKEN: z.string().min(16).optional(),
  /** Comma-separated allowlist, or `*` for public read endpoints only. */
  ALLOWED_ORIGINS: z.string().default("*"),
  /** Upstash Redis REST URL. Without it, rate limiting degrades to in-memory. */
  RATE_LIMIT_REDIS_URL: z.string().url().optional(),
  RATE_LIMIT_REDIS_TOKEN: z.string().optional(),
  /** Minimum client version still accepted for score submission. */
  MIN_CLIENT_VERSION: z.string().default("0.0.0"),
  COMMIT_SHA: z.string().default("unknown"),
  SERVICE_VERSION: z.string().default("0.1.0"),
});

export type Env = z.infer<typeof EnvSchema>;

export interface EnvResult {
  ok: boolean;
  env: Env;
  errors: string[];
}

/** Never throws: returns the problems so `/readyz` can report them. */
export function readEnv(source: NodeJS.ProcessEnv = process.env): EnvResult {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return { ok: true, env: parsed.data, errors: [] };

  const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

  // Still return a usable env: drop only the offending keys so the server can
  // boot far enough to *report* the misconfiguration through /readyz, rather
  // than crashing at cold start with a less diagnosable error.
  const invalid = new Set(
    parsed.error.issues.map((i) => i.path[0]).filter((key): key is string => typeof key === "string"),
  );
  const sanitised: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!invalid.has(key)) sanitised[key] = value;
  }
  const fallback = EnvSchema.safeParse(sanitised);
  return { ok: false, env: fallback.success ? fallback.data : EnvSchema.parse({}), errors };
}
