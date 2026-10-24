import { Hono } from "hono";
import type { Context } from "hono";
import { RunModeSchema } from "../../src/shared/contracts.js";
import type { LeaderboardServiceDeps } from "../services/leaderboard.js";
import { around, dailyBoard, globalBoard } from "../services/leaderboard.js";
import { RATE_LIMITS, type RateLimiter } from "../ratelimit.js";
import { clientIp, rateLimited, unauthorized, validationError } from "./helpers.js";
import type { AppBindings } from "../app.js";

export interface LeaderboardRouteDeps {
  leaderboardService: LeaderboardServiceDeps;
  limiter: RateLimiter;
}

/**
 * Board reads (task 3.7) — public, rate-limited per IP.
 *
 * `GET /leaderboard` — global best-per-player. `GET /leaderboard/around` —
 * the caller's neighbourhood (requires a session, so it knows who "you" is).
 * `GET /daily` — the daily board.
 */
export function leaderboardRoutes(deps: LeaderboardRouteDeps): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  const guard = async (c: Context<AppBindings>): Promise<Response | null> => {
    const limit = await deps.limiter.check(`read:${clientIp(c)}`, RATE_LIMITS.read.limit, RATE_LIMITS.read.windowMs);
    return limit.ok ? null : rateLimited(c, limit.retryAfterMs);
  };

  app.get("/", async (c) => {
    const blocked = await guard(c);
    if (blocked) return blocked;
    const mode = RunModeSchema.safeParse(c.req.query("mode") ?? "endless");
    if (!mode.success) return validationError(c, "Unknown mode");
    const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);
    return c.json(await globalBoard(deps.leaderboardService, mode.data, Number.isFinite(limit) ? limit : 20));
  });

  app.get("/around", async (c) => {
    const blocked = await guard(c);
    if (blocked) return blocked;
    const player = c.get("player");
    if (!player) return unauthorized(c);
    const mode = RunModeSchema.safeParse(c.req.query("mode") ?? "endless");
    if (!mode.success) return validationError(c, "Unknown mode");
    return c.json(await around(deps.leaderboardService, player, mode.data));
  });

  app.get("/daily", async (c) => {
    const blocked = await guard(c);
    if (blocked) return blocked;
    const mode = RunModeSchema.safeParse(c.req.query("mode") ?? "daily");
    if (!mode.success) return validationError(c, "Unknown mode");
    const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);
    const day = c.req.query("day");
    if (day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return validationError(c, "day must be YYYY-MM-DD");
    return c.json(await dailyBoard(deps.leaderboardService, mode.data, Number.isFinite(limit) ? limit : 20, day));
  });

  return app;
}
