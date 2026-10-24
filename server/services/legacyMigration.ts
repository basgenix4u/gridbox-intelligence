import type { LegacyScoreInput, PlayerRecord, Repositories } from "../ports/repositories.js";
import type { LegacyScore, MigrateScoresRequest } from "../../src/shared/contracts.js";
import { fail } from "../errors.js";

/**
 * Legacy-score migration (task 3.13).
 *
 * A returning player's browser holds a table of scores produced before this
 * server existed. When they set a username and play after the upgrade, that
 * history is uploaded once and folded into their profile, so their record
 * reflects in the system instead of living in one browser forever.
 *
 * Three properties make it safe:
 *
 * 1. **Idempotent** — the browser's own entry ids are the dedupe key, enforced
 *    by a unique index. A retried, duplicated or partially-failed upload
 *    inserts nothing the second time, so totals can never double-count.
 * 2. **One-time** — the client keeps a local flag, and the server can answer
 *    "already migrated" without re-reading the table.
 * 3. **Honest** — legacy scores fold into `best_score` and `total_runs` only.
 *    They carry no attestation, so they never reach the competitive boards;
 *    a migrated score is history, not a verified run.
 */

export interface MigrationServiceDeps {
  repos: Repositories;
}

/** The version a pre-versioning browser entry is stored under. */
export const LEGACY_SCORING_VERSION = 1;

/** Normalises a browser entry for storage, tagging a missing version as 1. */
export function toLegacyInput(entry: LegacyScore): LegacyScoreInput {
  return {
    clientId: entry.id,
    score: entry.score,
    level: entry.level,
    chips: entry.chips,
    maxCombo: entry.maxCombo,
    playedAt: entry.date,
    scoringVersion: entry.scoringVersion ?? LEGACY_SCORING_VERSION,
  };
}

export interface MigrationResult {
  migrated: number;
  duplicates: number;
  bestScore: number;
  totalRuns: number;
}

export async function migrateScores(
  deps: MigrationServiceDeps,
  player: PlayerRecord,
  req: MigrateScoresRequest,
): Promise<MigrationResult> {
  const inputs = req.entries.map(toLegacyInput);

  // Reject a batch that repeats an id within itself — the caller is buggy, and
  // silently deduplicating would hide it.
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.clientId)) {
      throw fail("VALIDATION_FAILED", "Duplicate entry id in the migration batch", 400);
    }
    seen.add(input.clientId);
  }

  const { inserted } = await deps.repos.legacyScores.insertMany(player.id, inputs);
  const duplicates = inputs.length - inserted;

  // Fold only what was actually new into the totals. On a retry, `inserted` is
  // zero and the totals are left exactly as they are — the idempotence that
  // makes a flaky connection harmless.
  let bestScore = player.bestScore;
  let totalRuns = player.totalRuns;
  if (inserted > 0) {
    const best = Math.max(...inputs.map((e) => e.score));
    const updated = await deps.repos.players.addRunTotals(player.id, best, inserted);
    bestScore = updated.bestScore;
    totalRuns = updated.totalRuns;
  }

  return { migrated: inserted, duplicates, bestScore, totalRuns };
}

/** True when this player's history has already been migrated. */
export async function hasMigrated(deps: MigrationServiceDeps, playerId: string): Promise<boolean> {
  return deps.repos.legacyScores.hasAny(playerId);
}
