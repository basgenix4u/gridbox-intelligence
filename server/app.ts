import { cors } from "hono/cors";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { sql } from "drizzle-orm";
import { createDatabase, type Database } from "../db/client.js";
import type { Env } from "./env.js";
import { readEnv } from "./env.js";
import { errorBody, onError } from "./errors.js";
import type { PlayerRecord, Repositories } from "./ports/repositories.js";
import { createDrizzleRepositories } from "./adapters/drizzleRepositories.js";
import { createMemoryRateLimiter, type RateLimiter } from "./ratelimit.js";
import { authRoutes, createSessionMiddleware } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { runRoutes } from "./routes/runs.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { moderationRoutes } from "./routes/moderation.js";
import type { PlayerServiceDeps } from "./services/players.js";
import type { RunServiceDeps } from "./services/runs.js";
import type { LeaderboardServiceDeps } from "./services/leaderboard.js";
import type { ModerationServiceDeps } from "./services/moderation.js";
import type { MigrationServiceDeps } from "./services/legacyMigration.js";
import { HARNESS_SCORE_PER_SECOND_P99 } from "./services/anticheat.js";

export interface AppOptions {
  env?: Env;
  /** Where to read configuration from. Tests pass a clean object. */
  envSource?: NodeJS.ProcessEnv;
  /** Injected for tests; otherwise built lazily from `DATABASE_URL`. */
  db?: Database | null;
  /** Injected repositories — the test seam; built from `db` when absent. */
  repositories?: Repositories;
  /** Injected rate limiter — the test seam; in-memory when absent. */
  rateLimiter?: RateLimiter;
  /** Epoch ms — injected so /healthz is deterministic. */
  startedAt?: number;
  /** Clock — injected so time-dependent checks (run timing) are testable. */
  now?: () => Date;
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
    player?: PlayerRecord;
  };
}

/**
 * The API application.
 *
 * Framework-agnostic on purpose: Vercel only supplies the entry point
 * (`api/index.ts`). Everything here is constructible in a test without a
 * running server, which is why `db`, `repositories` and `rateLimiter` are
 * injected rather than global.
 */
export function createApp(options: AppOptions = {}): Hono<AppBindings> {
  const envResult = readEnv(options.envSource ?? process.env);
  const env = options.env ?? envResult.env;
  const startedAt = options.startedAt ?? Date.now();
  const origins = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // A deployment whose environment did not validate — a production allowlist
  // that was never pinned, a missing signing secret — fails *closed*: no
  // cross-origin request is approved, while /readyz reports exactly why.
  // Anything else would leave authenticated writes open to every origin.
  const corsOrigin: string | string[] = !envResult.ok ? [] : origins.includes("*") ? "*" : origins;

  const app = new Hono<AppBindings>();

  app.use("*", secureHeaders());
  app.use("*", cors({ origin: corsOrigin, credentials: false }));
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
      // The environment as *configured*, not as salvaged: when the env fails
      // validation the fallback re-parses without the offending keys, and
      // reporting that would have a broken production deployment claim to be
      // "development". /readyz is where the problems are listed.
      environment: envResult.ok ? env.NODE_ENV : ((options.envSource ?? process.env).NODE_ENV ?? env.NODE_ENV),
      configured: envResult.ok,
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

  // ---------------------------------------------------------------- services
  // Repositories are the only persistence seam: injected in tests, built from
  // the database in production, absent (503) when nothing is configured.
  const now = options.now ?? (() => new Date());
  const repositories: Repositories | null =
    options.repositories ?? (options.db ? createDrizzleRepositories(options.db) : null);
  const limiter = options.rateLimiter ?? createMemoryRateLimiter();
  const serviceAvailable = repositories !== null;

  if (repositories) {
    const playerService: PlayerServiceDeps = { repos: repositories, authSecret: env.AUTH_SECRET ?? "" };
    const runService: RunServiceDeps = {
      repos: repositories,
      authSecret: env.AUTH_SECRET ?? "",
      now,
      scorePerSecondP99: HARNESS_SCORE_PER_SECOND_P99,
    };
    const leaderboardService: LeaderboardServiceDeps = { repos: repositories, now };
    const moderationService: ModerationServiceDeps = { repos: repositories };
    const migrationService: MigrationServiceDeps = { repos: repositories };
    const loadPlayerByTokenHash = (hash: string): Promise<PlayerRecord | null> =>
      repositories.players.findByTokenHash(hash);

    const session = createSessionMiddleware({
      authSecret: env.AUTH_SECRET,
      loadPlayerByTokenHash,
      serviceAvailable,
    });
    // Board reads are public; a session, when present, only adds "isYou".
    const optionalSession = createSessionMiddleware({
      authSecret: env.AUTH_SECRET,
      loadPlayerByTokenHash,
      serviceAvailable,
      required: false,
    });

    api.route("/v1/auth", authRoutes({ playerService, limiter, loadPlayerByTokenHash }));

    api.use("/v1/me/*", session);
    api.route("/v1/me", meRoutes({ playerService, migrationService, limiter }));

    api.use("/v1/runs/*", session);
    api.route("/v1/runs", runRoutes({ runService, limiter }));

    api.use("/v1/leaderboard/*", optionalSession);
    api.route("/v1/leaderboard", leaderboardRoutes({ leaderboardService, limiter }));

    api.use("/v1/names/*", session);
    api.route("/v1", moderationRoutes({ moderationService, limiter, moderationToken: env.MODERATION_TOKEN }));
  }

  const basePath = options.basePath ?? "/";
  app.route(basePath, api);

  app.notFound((c) =>
    c.json(errorBody("NOT_FOUND", `No route for ${c.req.method} ${c.req.path}`, undefined, c.get("requestId")), 404),
  );

  return app;
}

export type App = ReturnType<typeof createApp>;
