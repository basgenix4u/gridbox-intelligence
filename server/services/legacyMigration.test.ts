import { describe, expect, it } from "vitest";
import { createMemoryRepositories } from "../adapters/memoryRepositories.js";
import { hasMigrated, LEGACY_SCORING_VERSION, migrateScores, toLegacyInput } from "./legacyMigration.js";
import { statusOf } from "../errors.js";
import { isAppError } from "../../src/core/errors/AppError.js";
import type { PlayerRecord } from "../ports/repositories.js";
import type { LegacyScore } from "../../src/shared/contracts.js";

/**
 * The legacy-score migration's contract is idempotence, so these tests are
 * mostly about what happens on the *second* call, the retry, and the partial
 * batch — the cases where a naive implementation double-counts.
 */

const PLAYER_ID = "11111111-2222-4333-8444-555555555555";

function playerRecord(overrides: Partial<PlayerRecord> = {}): PlayerRecord {
  const at = new Date("2026-10-24T09:00:00.000Z");
  return {
    id: PLAYER_ID,
    anonTokenHash: "h".repeat(64),
    displayName: "Nova",
    initials: "NOV",
    createdAt: at,
    lastSeenAt: at,
    totalRuns: 0,
    bestScore: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<LegacyScore> = {}): LegacyScore {
  return {
    id: "local-1",
    score: 5_000,
    level: 8,
    chips: 60,
    maxCombo: 8,
    date: 1_700_000_000_000,
    ...overrides,
  };
}

function harness() {
  const repos = createMemoryRepositories();
  return { repos, service: { repos } };
}

/** Captures a rejected call as its stable code plus HTTP status. */
async function rejection(promise: Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await promise;
  } catch (err) {
    if (isAppError(err)) return { code: err.code, status: statusOf(err) };
    throw err;
  }
  throw new Error("expected the call to fail");
}

describe("toLegacyInput", () => {
  it("tags a pre-versioning entry as version 1 and keeps an explicit one", () => {
    expect(toLegacyInput(entry()).scoringVersion).toBe(LEGACY_SCORING_VERSION);
    expect(toLegacyInput(entry({ scoringVersion: 2 })).scoringVersion).toBe(2);
  });

  it("maps the browser's fields onto the stored shape", () => {
    const input = toLegacyInput(entry({ id: "abc", score: 10, date: 5 }));
    expect(input).toEqual({
      clientId: "abc",
      score: 10,
      level: 8,
      chips: 60,
      maxCombo: 8,
      playedAt: 5,
      scoringVersion: 1,
    });
  });
});

describe("migrateScores", () => {
  it("folds a batch into the profile totals", async () => {
    const { repos, service } = harness();
    await repos.players.create(playerRecord());
    const result = await migrateScores(service, playerRecord(), {
      entries: [entry({ id: "a", score: 5_000 }), entry({ id: "b", score: 9_000 })],
    });
    expect(result).toEqual({ migrated: 2, duplicates: 0, bestScore: 9_000, totalRuns: 2 });
    const stored = await repos.players.findById(PLAYER_ID);
    expect(stored).toMatchObject({ bestScore: 9_000, totalRuns: 2 });
    expect(await hasMigrated(service, PLAYER_ID)).toBe(true);
  });

  it("is idempotent — a retry with the same ids changes nothing", async () => {
    const { repos, service } = harness();
    await repos.players.create(playerRecord());
    const batch = { entries: [entry({ id: "a", score: 5_000 }), entry({ id: "b", score: 9_000 })] };

    await migrateScores(service, playerRecord(), batch);
    const again = await migrateScores(service, playerRecord({ bestScore: 9_000, totalRuns: 2 }), batch);

    expect(again).toEqual({ migrated: 0, duplicates: 2, bestScore: 9_000, totalRuns: 2 });
    const stored = await repos.players.findById(PLAYER_ID);
    expect(stored).toMatchObject({ bestScore: 9_000, totalRuns: 2 });
  });

  it("keeps only the new entries on a partially-retried batch", async () => {
    const { repos, service } = harness();
    await repos.players.create(playerRecord());
    await migrateScores(service, playerRecord(), { entries: [entry({ id: "a", score: 5_000 })] });
    const partial = await migrateScores(service, playerRecord({ bestScore: 5_000, totalRuns: 1 }), {
      entries: [entry({ id: "a", score: 5_000 }), entry({ id: "b", score: 7_000 })],
    });
    expect(partial).toEqual({ migrated: 1, duplicates: 1, bestScore: 7_000, totalRuns: 2 });
  });

  it("never lowers the best score", async () => {
    const { repos, service } = harness();
    await repos.players.create(playerRecord());
    // A player who already has a higher score on the server.
    const established = await repos.players.addRunTotals(PLAYER_ID, 20_000, 5);
    const result = await migrateScores(service, established, { entries: [entry({ id: "a", score: 5_000 })] });
    expect(result.bestScore).toBe(20_000);
    expect(result.totalRuns).toBe(6);
  });

  it("rejects a batch that repeats an id within itself", async () => {
    const { repos, service } = harness();
    await repos.players.create(playerRecord());
    expect(
      await rejection(
        migrateScores(service, playerRecord(), {
          entries: [entry({ id: "same" }), entry({ id: "same", score: 1 })],
        }),
      ),
    ).toEqual({ code: "VALIDATION_FAILED", status: 400 });
    expect((await repos.players.findById(PLAYER_ID))?.totalRuns).toBe(0);
  });

  it("stores the migrated history for the profile to show", async () => {
    const { repos, service } = harness();
    await repos.players.create(playerRecord());
    await migrateScores(service, playerRecord(), {
      entries: [entry({ id: "a", score: 5_000 }), entry({ id: "b", score: 9_000 })],
    });
    const history = await repos.legacyScores.list(PLAYER_ID, 10);
    expect(history.map((e) => [e.clientId, e.score, e.scoringVersion])).toEqual([
      ["b", 9_000, 1],
      ["a", 5_000, 1],
    ]);
  });

  it("reports no migration for a player who never uploaded", async () => {
    const { service } = harness();
    expect(await hasMigrated(service, PLAYER_ID)).toBe(false);
  });
});
