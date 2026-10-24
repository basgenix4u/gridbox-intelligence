import type { PlayerRecord, Repositories } from "../ports/repositories.js";
import type { LeaderboardResponse, LeaderboardRow, RunMode } from "../../src/shared/contracts.js";
import { utcDay } from "./runs.js";

/**
 * Leaderboard service (task 3.7).
 *
 * Two scopes, per the locked decision: a global board (best run per player,
 * from `runs`) and a daily board (the materialised `leaderboard_daily`
 * rollup). Names held for moderation are excluded by the repositories — a
 * reported name never reaches a board until a human clears it.
 */

export interface LeaderboardServiceDeps {
  repos: Repositories;
  now: () => Date;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const AROUND_SPAN = 2;

function withRanks(
  entries: { playerId: string; initials: string; score: number; level?: number }[],
  youId?: string,
): LeaderboardRow[] {
  return entries.map((entry, index) => ({
    rank: index + 1,
    playerId: entry.playerId,
    initials: entry.initials,
    score: entry.score,
    level: entry.level ?? 0,
    isYou: youId !== undefined && entry.playerId === youId,
  }));
}

export async function globalBoard(
  deps: LeaderboardServiceDeps,
  mode: RunMode,
  limit = DEFAULT_LIMIT,
): Promise<LeaderboardResponse> {
  const clamped = Math.min(Math.max(1, limit), MAX_LIMIT);
  const entries = await deps.repos.runs.globalBoard(mode, clamped);
  return { scope: "global", mode, day: null, rows: withRanks(entries) };
}

export async function around(
  deps: LeaderboardServiceDeps,
  player: PlayerRecord,
  mode: RunMode,
): Promise<LeaderboardResponse> {
  const { rows } = await deps.repos.runs.around(player.id, mode, AROUND_SPAN);
  return { scope: "global", mode, day: null, rows: withRanks(rows, player.id) };
}

export async function dailyBoard(
  deps: LeaderboardServiceDeps,
  mode: RunMode,
  limit = DEFAULT_LIMIT,
  day?: string,
): Promise<LeaderboardResponse> {
  const clamped = Math.min(Math.max(1, limit), MAX_LIMIT);
  const targetDay = day ?? utcDay(deps.now());
  const entries = await deps.repos.runs.dailyBoard(targetDay, mode, clamped);
  return { scope: "daily", mode, day: targetDay, rows: withRanks(entries) };
}
