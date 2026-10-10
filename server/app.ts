import { cors } from "hono/cors";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { sql } from "drizzle-orm";
import { createDatabase, type Database } from "../db/client.js";
import type { Env } from "./env.js";
import { readEnv } from "./env.js";
import { errorBody, onError } from "./errors.js";

export interface AppOptions {
  env?: Env;
  /** Where to read configuration from. Tests pass a clean object. */
  envSource?: NodeJS.ProcessEnv;
  /** Injected for tests; otherwise built lazily from `DATABASE_URL`. */
  db?: Database | null;
  /** Epoch ms — injected so /healthz is deterministic. */
  startedAt?: number;
  /**
   * Mount path for the whole API. Vercel serves this function under `/api`, so
   * the incoming path is `/api/v1/healthz` while the routes are declared as
   * `/v1/healthz`. Default `"/"` keeps local and test usage unprefixed.
   */
  basePath?: string;
}

export interface AppBindings {
  Variables: {
    requestId: string;
  };
}

/**
 * The API application.
 *
 * Framework-agnostic on purpose: Vercel only supplies the entry point
 * (`api/[[...route]].ts`). Everything here is constructible in a test without a
 * running server, which is why `db` and `env` are injected rather than global.
 */
export function createApp(options: AppOptions = {}): Hono<AppBindings> {
  const envResult = readEnv(options.envSource ?? process.env);
  const env = options.env ?? envResult.env;
  const startedAt = options.startedAt ?? Date.now();
  const origins = env.ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const app = new Hono<AppBindings>();

  app.use("*", secureHeaders());
  app.use("*", cors({ origin: origins.includes("*") ? "*" : origins, credentials: false }));
  app.use("*", async (c, next) => {
    c.set("requestId", c.req.header("x-request-id") ?? crypto.randomUUID());
    c.header("x-request-id", c.get("requestId"));
    await next();
  });

  app.onError(onError);

  const db = (): Database | null => {
    if (options.db !== undefined) return options.db;
    if (!env.DATABASE_URL) return null;
    return createDatabase(env.DATABASE_URL);
  };

  const api = new Hono<AppBindings>();

  api.get("/v1/healthz", (c) =>
    c.json({
      status: "ok",
      version: env.SERVICE_VERSION,
      commit: env.COMMIT_SHA,
      uptimeMs: Date.now() - startedAt,
      environment: env.NODE_ENV,
    }),
  );

  api.get("/v1/readyz", async (c) => {
    const problems: string[] = [...envResult.errors];
    let database: "up" | "down" | "not-configured" = "not-configured";

    const connection = db();
    if (connection) {
      try {
        await connection.execute(sql`select 1`);
        database = "up";
      } catch {
        database = "down";
        problems.push("database: connection failed");
      }
    } else {
      problems.push("database: DATABASE_URL is not set");
    }

    if (problems.length) {
      return c.json({ status: "degraded", database, problems, version: env.SERVICE_VERSION }, 503);
    }
    return c.json({ status: "ready", database, version: env.SERVICE_VERSION });
  });

  const basePath = options.basePath ?? "/";
  app.route(basePath, api);

  app.notFound((c) =>
    c.json(errorBody("NOT_FOUND", `No route for ${c.req.method} ${c.req.path}`, undefined, c.get("requestId")), 404),
  );

  return app;
}

export type App = ReturnType<typeof createApp>;
