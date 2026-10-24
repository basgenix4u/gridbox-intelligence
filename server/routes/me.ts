import { Hono } from "hono";
import { UpdateMeRequestSchema } from "../../src/shared/contracts.js";
import type { PlayerServiceDeps } from "../services/players.js";
import { toPlayer, updateMe } from "../services/players.js";
import { formatIssues, readBody, unauthorized, validationError } from "./helpers.js";
import type { AppBindings } from "../app.js";

export interface MeRouteDeps {
  playerService: PlayerServiceDeps;
}

/** `GET /me` and `PATCH /me` — the player's own profile. */
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

  return app;
}
