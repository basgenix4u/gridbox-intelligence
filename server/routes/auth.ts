import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { AnonymousAuthRequestSchema } from "../../src/shared/contracts.js";
import type { PlayerRecord } from "../ports/repositories.js";
import type { PlayerServiceDeps } from "../services/players.js";
import { createAnonymousPlayer } from "../services/players.js";
import { hashToken, verifySessionToken } from "../auth.js";
import { RATE_LIMITS, type RateLimiter } from "../ratelimit.js";
import { clientIp, formatIssues, rateLimited, readBody, unauthorized, validationError } from "./helpers.js";
import type { AppBindings } from "../app.js";

export interface AuthRouteDeps {
  playerService: PlayerServiceDeps;
  limiter: RateLimiter;
  loadPlayerByTokenHash: (hash: string) => Promise<PlayerRecord | null>;
}

/**
 * `POST /auth/anonymous` — mints an anonymous session.
 *
 * Rate-limited per IP: session creation is the cheapest way to flood the
 * players table, so it gets the strictest anonymous budget.
 */
export function authRoutes(deps: AuthRouteDeps): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post("/anonymous", async (c) => {
    const limit = await deps.limiter.check(`auth:${clientIp(c)}`, RATE_LIMITS.auth.limit, RATE_LIMITS.auth.windowMs);
    if (!limit.ok) return rateLimited(c, limit.retryAfterMs);

    const body = await readBody(c.req);
    const parsed = AnonymousAuthRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(c, formatIssues(parsed.error).join("; "));
    const result = await createAnonymousPlayer(deps.playerService, parsed.data.displayName);
    return c.json(result, 201);
  });

  return app;
}

/**
 * Bearer-session middleware. Verifies the token, loads the player and puts it
 * on the context; unauthenticated requests get a 401 without touching the
 * route. A missing AUTH_SECRET is a deployment fault, not an auth fault — it
 * answers 503 so `/readyz` stays the single source of truth for health.
 */
export function createSessionMiddleware(deps: {
  authSecret: string | undefined;
  loadPlayerByTokenHash: (hash: string) => Promise<PlayerRecord | null>;
  serviceAvailable: boolean;
  /**
   * When true (the default) a request without a valid session is rejected.
   * Public reads pass false: a token, if present, still identifies the player
   * ("isYou" on the board), but no token is not an error.
   */
  required?: boolean;
}): MiddlewareHandler<AppBindings> {
  const required = deps.required ?? true;
  return async (c, next) => {
    if (!deps.serviceAvailable) {
      const requestId = c.get("requestId");
      return c.json(
        { error: { code: "SERVICE_UNAVAILABLE", message: "The API has no database configured", requestId } },
        503,
      );
    }
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      if (required) return unauthorized(c);
      return next();
    }
    if (!deps.authSecret) return unauthorized(c);

    const claims = await verifySessionToken(token, deps.authSecret);
    if (!claims) return unauthorized(c);

    const player = await deps.loadPlayerByTokenHash(hashToken(token));
    if (!player) return unauthorized(c, "Session is no longer valid");

    c.set("player", player);
    await next();
  };
}
