import { Hono } from "hono";
import { ModerationResolveRequestSchema, NameReportRequestSchema } from "../../src/shared/contracts.js";
import type { ModerationServiceDeps } from "../services/moderation.js";
import { listQueue, reportName, resolveReport } from "../services/moderation.js";
import { RATE_LIMITS, type RateLimiter } from "../ratelimit.js";
import { formatIssues, rateLimited, readBody, unauthorized, validationError } from "./helpers.js";
import type { AppBindings } from "../app.js";

export interface ModerationRouteDeps {
  moderationService: ModerationServiceDeps;
  limiter: RateLimiter;
  /** Owner token guarding the admin endpoints. */
  moderationToken: string | undefined;
}

/**
 * Moderation routes (task 3.9).
 *
 * `POST /names/:id/report` — players report a display name; the report holds
 * the name out of every board until a human clears it. Strictly rate-limited:
 * reports are an abuse vector.
 *
 * `/admin/moderation` — the owner's queue, guarded by `MODERATION_TOKEN`
 * (a bearer token compared in constant time, never a player session).
 */
export function moderationRoutes(deps: ModerationRouteDeps): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post("/names/:id/report", async (c) => {
    const player = c.get("player");
    if (!player) return unauthorized(c);
    const limit = await deps.limiter.check(
      `report:${player.id}`,
      RATE_LIMITS.report.limit,
      RATE_LIMITS.report.windowMs,
    );
    if (!limit.ok) return rateLimited(c, limit.retryAfterMs);

    const body = await readBody(c.req);
    const parsed = NameReportRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(c, formatIssues(parsed.error).join("; "));
    try {
      const result = await reportName(deps.moderationService, player, c.req.param("id"), parsed.data.reason);
      return c.json(result, 201);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : "Report failed";
      const status = code === "NOT_FOUND" ? 404 : 400;
      return validationError(c, message, code as "VALIDATION_FAILED", status);
    }
  });

  const admin = new Hono<AppBindings>();

  admin.use("*", async (c, next) => {
    if (!deps.moderationToken) {
      return validationError(c, "Moderation is not configured on this deployment", "FORBIDDEN", 503);
    }
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || !timingSafeEqual(token, deps.moderationToken)) return unauthorized(c, "Invalid moderator token");
    await next();
  });

  admin.get("/moderation", async (c) => {
    const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
    return c.json(await listQueue(deps.moderationService, Number.isFinite(limit) ? limit : 100));
  });

  admin.post("/moderation/:id", async (c) => {
    const body = await readBody(c.req);
    const parsed = ModerationResolveRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(c, formatIssues(parsed.error).join("; "));
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id)) return validationError(c, "Invalid report id");
    try {
      const result = await resolveReport(deps.moderationService, id, parsed.data.action, "moderator");
      return c.json(result);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : "Resolution failed";
      const status = code === "NOT_FOUND" ? 404 : 400;
      return validationError(c, message, code as "VALIDATION_FAILED", status);
    }
  });

  app.route("/admin", admin);
  return app;
}

/** Constant-time string comparison — no early exit on first differing byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
