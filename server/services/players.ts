import { randomUUID } from "node:crypto";
import type { PlayerRecord, Repositories } from "../ports/repositories.js";
import type { AuthResponse, Player, UpdateMeRequest } from "../../src/shared/contracts.js";
import { hashToken, issueSessionToken } from "../auth.js";
import { checkDisplayName, checkInitials, toInitials } from "../names.js";
import { fail } from "../errors.js";

/**
 * Player identity service (task 3.7).
 *
 * Anonymous sessions: the service mints the player id first, issues a session
 * token bound to it, and stores only the token's hash. Display names and
 * initials pass the policy filter before they are stored — the filter is the
 * write-time gate the moderation decision relies on.
 */

export interface PlayerServiceDeps {
  repos: Repositories;
  authSecret: string;
}

const DEFAULT_DISPLAY_NAME = "YOU";

export async function createAnonymousPlayer(deps: PlayerServiceDeps, requestedName?: string): Promise<AuthResponse> {
  let displayName = DEFAULT_DISPLAY_NAME;
  if (requestedName !== undefined) {
    const check = checkDisplayName(requestedName);
    if (!check.ok) throw fail(check.code, check.message, 400);
    displayName = check.value;
  }
  const initials = toInitials(displayName);
  const initialsCheck = checkInitials(initials);
  if (!initialsCheck.ok) throw fail(initialsCheck.code, initialsCheck.message, 400);

  const playerId = randomUUID();
  const token = await issueSessionToken(playerId, deps.authSecret);
  const player = await deps.repos.players.create({
    id: playerId,
    anonTokenHash: hashToken(token),
    displayName,
    initials: initialsCheck.value,
  });

  return { token, player: toPlayer(player) };
}

export function toPlayer(record: PlayerRecord): Player {
  return {
    id: record.id,
    displayName: record.displayName,
    initials: record.initials,
    bestScore: record.bestScore,
    totalRuns: record.totalRuns,
    createdAt: record.createdAt.toISOString(),
  };
}

export async function updateMe(deps: PlayerServiceDeps, player: PlayerRecord, req: UpdateMeRequest): Promise<Player> {
  let displayName = player.displayName;
  let initials = player.initials;

  if (req.displayName !== undefined) {
    const check = checkDisplayName(req.displayName);
    if (!check.ok) throw fail(check.code, check.message, 400);
    displayName = check.value;
    initials = toInitials(displayName);
  }
  if (req.initials !== undefined) {
    const check = checkInitials(req.initials);
    if (!check.ok) throw fail(check.code, check.message, 400);
    initials = check.value;
  }
  const initialsCheck = checkInitials(initials);
  if (!initialsCheck.ok) throw fail(initialsCheck.code, initialsCheck.message, 400);

  const updated = await deps.repos.players.updateName(player.id, { displayName, initials: initialsCheck.value });
  return toPlayer(updated);
}
