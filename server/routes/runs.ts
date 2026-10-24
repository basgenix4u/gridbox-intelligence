import { Hono } from "hono";
import { RunStartRequestSchema, RunSubmitRequestSchema } from "../../src/shared/contracts.js";
import type { RunServiceDeps } from "../services/runs.js";
import { startRun, submitRun } from "../services/runs.js";
import { RATE_LIMITS, type RateLimiter } from "../ratelimit.js";
import { formatIssues, rateLimited, readBody, unauthorized, validationError } from "./helpers.js";
import type { AppBindings } from "../app.js";

export interface RunRouteDeps {
  runService: RunServiceDeps;
  limiter: RateLimiter;
}

/**
 * Run lifecycle routes (tasks 3.7 + 3.8).
 *
 * `POST /runs/start` issues the seed and attestation nonce; `POST /runs/:id/submit`
 * verifies the start token, replays the attestation chain and assesses
 * plausibility before storing anything. Submission is rate-limited per player.
 */
export function runRoutes(deps: RunRouteDeps): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post("/start", async (c) => {
    const player = c.get("player");
    if (!player) return unauthorized(c);
    const limit = await deps.limiter.check(
      `submit:${player.id}`,
      RATE_LIMITS.submit.limit,
      RATE_LIMITS.submit.windowMs,
    );
    if (!limit.ok) return rateLimited(c, limit.retryAfterMs);

    const body = await readBody(c.req);
    const parsed = RunStartRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(c, formatIssues(parsed.error).join("; "));
    const result = await startRun(deps.runService, player, parsed.data);
    return c.json(result, 201);
  });

  app.post("/:id/submit", async (c) => {
    const player = c.get("player");
    if (!player) return unauthorized(c);
    const limit = await deps.limiter.check(
      `submit:${player.id}`,
      RATE_LIMITS.submit.limit,
      RATE_LIMITS.submit.windowMs,
    );
    if (!limit.ok) return rateLimited(c, limit.retryAfterMs);

    const body = await readBody(c.req);
    const parsed = RunSubmitRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(c, formatIssues(parsed.error).join("; "));
    try {
      const result = await submitRun(deps.runService, player, c.req.param("id"), parsed.data);
      return c.json(result);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : "Submission failed";
      return validationError(c, message, code as "VALIDATION_FAILED", statusForCode(code));
    }
  });

  return app;
}

/** Maps service error codes to HTTP statuses. */
function statusForCode(code: string | undefined): 400 | 404 | 409 {
  switch (code) {
    case "RUN_NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    default:
      return 400;
  }
}
