import { Hono } from "hono";
import { MigrateScoresRequestSchema, UpdateMeRequestSchema } from "../../src/shared/contracts.js";
import type { PlayerServiceDeps } from "../services/players.js";
import { toPlayer, updateMe } from "../services/players.js";
import type { MigrationServiceDeps } from "../services/legacyMigration.js";
import { hasMigrated, migrateScores } from "../services/legacyMigration.js";
import { RATE_LIMITS, type RateLimiter } from "../ratelimit.js";
import { formatIssues, rateLimited, readBody, unauthorized, validationError } from "./helpers.js";
import type { AppBindings } from "../app.js";

export interface MeRouteDeps {
  playerService: PlayerServiceDeps;
  migrationService: MigrationServiceDeps;
  limiter: RateLimiter;
}

/**
 * `GET /me`, `PATCH /me` and the one-shot legacy-score migration.
 *
 * `POST /me/migrate-scores` is the endpoint a returning player's browser calls
 * once, after they set a username: their pre-server history is folded into the
 * profile. It is idempotent — the browser's own entry ids are the dedupe key,
 * so a retry reports duplicates and changes nothing.
 */
export function meRoutes(deps: MeRouteDeps): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/", (c) => {
    const player = c.get("player");
    if (!player) return unauthorized(c);
    return c.json(toPlayer(player));
  });

  app.patch("/", async (c) => {
    const player = c.get("player");
    if (!player) return unauthorized(c);
    const body = await readBody(c.req);
    const parsed = UpdateMeRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(c, formatIssues(parsed.error).join("; "));
    try {
      const updated = await updateMe(deps.playerService, player, parsed.data);
      return c.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      const code = (err as { code?: string }).code ?? "VALIDATION_FAILED";
      return validationError(c, message, code as "VALIDATION_FAILED", 400);
    }
  });

  app.post("/migrate-scores", async (c) => {
    const player = c.get("player");
    if (!player) return unauthorized(c);
    const limit = await deps.limiter.check(
      `migrate:${player.id}`,
      RATE_LIMITS.submit.limit,
      RATE_LIMITS.submit.windowMs,
    );
    if (!limit.ok) return rateLimited(c, limit.retryAfterMs);

    const body = await readBody(c.req);
    const parsed = MigrateScoresRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(c, formatIssues(parsed.error).join("; "));
    const result = await migrateScores(deps.migrationService, player, parsed.data);
    return c.json(result);
  });

  /** Whether this player's local history has already been migrated. */
  app.get("/migration-status", async (c) => {
    const player = c.get("player");
    if (!player) return unauthorized(c);
    const migrated = await hasMigrated(deps.migrationService, player.id);
    return c.json({ migrated });
  });

  return app;
}
