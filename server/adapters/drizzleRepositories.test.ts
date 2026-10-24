import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDrizzleRepositories, DuplicateRunError } from "./drizzleRepositories.js";
import { createTestDatabase, type TestDatabase } from "./testDatabase.js";
import { players as playersTable } from "../../db/schema.js";
import type { NewRun, Repositories } from "../ports/repositories.js";

/**
 * Integration tests: the drizzle adapters against a real Postgres (PGlite,
 * in-process). The memory adapters prove the service logic; this file proves
 * the *SQL* — composite-key upserts, DISTINCT ON best-per-player, the rank
 * window function, held-name exclusion, unique constraints and FK cascades —
 * which is exactly what the in-memory fakes cannot do.
 */

let test: TestDatabase;
let repos: Repositories;

const P1 = "11111111-2222-4333-8444-555555555555";
const P2 = "22222222-3333-4444-8555-666666666666";
const P3 = "33333333-4444-4555-8666-777777777777";

beforeAll(async () => {
  test = await createTestDatabase();
  repos = createDrizzleRepositories(test.db);
}, 60_000);

afterAll(async () => {
  await test.close();
});

async function player(id: string, initials: string): Promise<void> {
  await repos.players.create({ id, anonTokenHash: `hash-${id}`, displayName: `Player ${initials}`, initials });
}

let runCounter = 0;
/** Deterministic, valid UUIDs so a failing assertion can name its row. */
function runId(): string {
  runCounter += 1;
  return `00000000-0000-4000-8000-${String(runCounter).padStart(12, "0")}`;
}

function run(playerId: string, score: number, overrides: Partial<NewRun> = {}): NewRun {
  return {
    id: runId(),
    playerId,
    mode: "endless",
    seed: 42,
    day: "2026-10-24",
    score,
    level: 1 + Math.floor(score / 700),
    chips: Math.floor(score / 80),
    maxCombo: 8,
    kills: 10,
    durationMs: 60_000,
    clientVersion: "0.1.0",
    attestation: { nonce: "n".repeat(32), links: 120 },
    validity: "ok",
    scoringVersion: 2,
    ...overrides,
  };
}

beforeEach(async () => {
  runCounter = 0;
  await test.reset();
});

describe("players", () => {
  it("creates with the caller-supplied id and the schema defaults", async () => {
    const created = await repos.players.create({ id: P1, anonTokenHash: "h1", displayName: "Nova", initials: "NOV" });
    expect(created.id).toBe(P1);
    expect(created.bestScore).toBe(0);
    expect(created.totalRuns).toBe(0);
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it("enforces the unique token hash at the database level", async () => {
    await repos.players.create({ id: P1, anonTokenHash: "same", displayName: "A", initials: "AAA" });
    await expect(
      repos.players.create({ id: P2, anonTokenHash: "same", displayName: "B", initials: "BBB" }),
    ).rejects.toThrow();
  });

  it("folds a run into the totals, keeping the best score monotonic", async () => {
    await player(P1, "AAA");
    expect((await repos.players.addRunTotals(P1, 500)).bestScore).toBe(500);
    const after = await repos.players.addRunTotals(P1, 300);
    expect(after.bestScore).toBe(500);
    expect(after.totalRuns).toBe(2);
    expect((await repos.players.addRunTotals(P1, 900)).bestScore).toBe(900);
  });

  it("updates the display name and initials", async () => {
    await player(P1, "AAA");
    const updated = await repos.players.updateName(P1, { displayName: "Vega", initials: "VEG" });
    expect(updated.displayName).toBe("Vega");
    expect(updated.initials).toBe("VEG");
    expect((await repos.players.findById(P1))?.initials).toBe("VEG");
  });

  it("finds a player by token hash and misses cleanly", async () => {
    await player(P1, "AAA");
    expect((await repos.players.findByTokenHash(`hash-${P1}`))?.id).toBe(P1);
    expect(await repos.players.findByTokenHash("nope")).toBeNull();
  });
});

describe("runs", () => {
  it("inserts and reads back a run", async () => {
    await player(P1, "AAA");
    const stored = await repos.runs.insert(run(P1, 12_000));
    expect(stored.score).toBe(12_000);
    expect(stored.validity).toBe("ok");
    expect((await repos.runs.findById(stored.id))?.score).toBe(12_000);
  });

  it("rejects a duplicate run id — the replay guard, in SQL", async () => {
    await player(P1, "AAA");
    const duplicate = run(P1, 1_000);
    await repos.runs.insert(duplicate);
    await expect(repos.runs.insert(duplicate)).rejects.toThrow(DuplicateRunError);
  });

  it("deletes the player's runs when the player is deleted (FK cascade)", async () => {
    await player(P1, "AAA");
    const stored = await repos.runs.insert(run(P1, 1_000));
    expect(await repos.runs.findById(stored.id)).not.toBeNull();
    await test.db.delete(playersTable).where(eq(playersTable.id, P1));
    expect(await repos.runs.findById(stored.id)).toBeNull();
  });

  it("keeps the best run per player on the global board", async () => {
    await player(P1, "AAA");
    await player(P2, "BBB");
    await repos.runs.insert(run(P1, 5_000));
    await repos.runs.insert(run(P1, 9_000));
    await repos.runs.insert(run(P2, 7_000));
    const board = await repos.runs.globalBoard("endless", 10);
    expect(board.map((r) => [r.initials, r.score])).toEqual([
      ["AAA", 9_000],
      ["BBB", 7_000],
    ]);
  });

  it("excludes suspect and rejected runs from the board", async () => {
    await player(P1, "AAA");
    await repos.runs.insert(run(P1, 50_000, { validity: "suspect" }));
    await repos.runs.insert(run(P1, 99_000, { validity: "rejected" }));
    await repos.runs.insert(run(P1, 1_000));
    const board = await repos.runs.globalBoard("endless", 10);
    expect(board.map((r) => r.score)).toEqual([1_000]);
  });

  it("separates boards by mode", async () => {
    await player(P1, "AAA");
    await repos.runs.insert(run(P1, 5_000));
    await repos.runs.insert(run(P1, 8_000, { mode: "daily" }));
    expect((await repos.runs.globalBoard("endless", 10)).map((r) => r.score)).toEqual([5_000]);
    expect((await repos.runs.globalBoard("daily", 10)).map((r) => r.score)).toEqual([8_000]);
  });

  it("excludes names held for moderation from every board, in SQL", async () => {
    await player(P1, "AAA");
    await player(P2, "BBB");
    await repos.runs.insert(run(P1, 9_000));
    await repos.runs.insert(run(P2, 7_000));
    // A pending report against P1 must remove them from the board entirely.
    await repos.reports.create({ reporterPlayerId: P2, reportedPlayerId: P1, reportedName: "AAA", reason: "bad" });
    const board = await repos.runs.globalBoard("endless", 10);
    expect(board.map((r) => r.initials)).toEqual(["BBB"]);
  });

  it("computes a global rank and the caller's neighbourhood", async () => {
    await player(P1, "AAA");
    await player(P2, "BBB");
    await player(P3, "CCC");
    await repos.runs.insert(run(P1, 1_000));
    await repos.runs.insert(run(P2, 5_000));
    await repos.runs.insert(run(P3, 9_000));
    // P1 is last, so its slice is clamped at the bottom: ranks 2..3.
    const mine = await repos.runs.around(P1, "endless", 1);
    expect(mine.rank).toBe(3);
    expect(mine.rows.map((r) => r.initials)).toEqual(["BBB", "AAA"]);
    const middle = await repos.runs.around(P2, "endless", 1);
    expect(middle.rank).toBe(2);
    expect(middle.rows.map((r) => r.initials)).toEqual(["CCC", "BBB", "AAA"]);
  });

  it("returns a null rank for a player with no runs", async () => {
    await player(P1, "AAA");
    await player(P2, "BBB");
    await repos.runs.insert(run(P2, 1_000));
    expect((await repos.runs.around(P1, "endless", 1)).rank).toBeNull();
  });

  it("maintains the daily rollup on its composite primary key", async () => {
    await player(P1, "AAA");
    await repos.runs.upsertDailyBest({ day: "2026-10-24", mode: "endless", playerId: P1, initials: "AAA", score: 500 });
    await repos.runs.upsertDailyBest({ day: "2026-10-24", mode: "endless", playerId: P1, initials: "AAA", score: 900 });
    await repos.runs.upsertDailyBest({ day: "2026-10-24", mode: "endless", playerId: P1, initials: "AAA", score: 300 });
    const board = await repos.runs.dailyBoard("2026-10-24", "endless", 10);
    // One row per (day, mode, player) — the composite key is what makes the
    // upsert an upsert instead of a duplicate-row generator.
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ playerId: P1, initials: "AAA", score: 900 });
  });

  it("keeps daily rows per mode and per day", async () => {
    await player(P1, "AAA");
    await repos.runs.upsertDailyBest({ day: "2026-10-24", mode: "endless", playerId: P1, initials: "AAA", score: 500 });
    await repos.runs.upsertDailyBest({ day: "2026-10-24", mode: "daily", playerId: P1, initials: "AAA", score: 600 });
    await repos.runs.upsertDailyBest({ day: "2026-10-23", mode: "endless", playerId: P1, initials: "AAA", score: 700 });
    expect(await repos.runs.dailyBoard("2026-10-24", "endless", 10)).toHaveLength(1);
    expect((await repos.runs.dailyBoard("2026-10-24", "daily", 10))[0].score).toBe(600);
    expect((await repos.runs.dailyBoard("2026-10-23", "endless", 10))[0].score).toBe(700);
  });

  it("excludes held names from the daily board too", async () => {
    await player(P1, "AAA");
    await player(P2, "BBB");
    await repos.runs.upsertDailyBest({ day: "2026-10-24", mode: "endless", playerId: P1, initials: "AAA", score: 900 });
    await repos.runs.upsertDailyBest({ day: "2026-10-24", mode: "endless", playerId: P2, initials: "BBB", score: 100 });
    await repos.reports.create({ reporterPlayerId: P2, reportedPlayerId: P1, reportedName: "AAA", reason: "bad" });
    const board = await repos.runs.dailyBoard("2026-10-24", "endless", 10);
    expect(board.map((r) => r.initials)).toEqual(["BBB"]);
  });

  it("orders the daily board by score", async () => {
    await player(P1, "AAA");
    await player(P2, "BBB");
    await player(P3, "CCC");
    await repos.runs.upsertDailyBest({ day: "2026-10-24", mode: "endless", playerId: P1, initials: "AAA", score: 100 });
    await repos.runs.upsertDailyBest({ day: "2026-10-24", mode: "endless", playerId: P2, initials: "BBB", score: 900 });
    await repos.runs.upsertDailyBest({ day: "2026-10-24", mode: "endless", playerId: P3, initials: "CCC", score: 500 });
    const board = await repos.runs.dailyBoard("2026-10-24", "endless", 10);
    expect(board.map((r) => r.initials)).toEqual(["BBB", "CCC", "AAA"]);
  });
});

describe("reports", () => {
  it("creates, lists and resolves a report", async () => {
    await player(P1, "AAA");
    await player(P2, "BBB");
    const report = await repos.reports.create({
      reporterPlayerId: P2,
      reportedPlayerId: P1,
      reportedName: "AAA",
      reason: "offensive",
    });
    expect(report.status).toBe("pending");
    expect(await repos.reports.hasPendingReport(P1)).toBe(true);
    expect(await repos.reports.hasPendingReport(P2)).toBe(false);

    const pending = await repos.reports.listPending(10);
    expect(pending.map((r) => r.id)).toEqual([report.id]);

    const resolved = await repos.reports.resolve(report.id, "upheld", "moderator");
    expect(resolved?.status).toBe("upheld");
    expect(await repos.reports.hasPendingReport(P1)).toBe(false);
    expect(await repos.reports.listPending(10)).toEqual([]);
  });

  it("keeps the reported name when the reporter disappears (ON DELETE set null)", async () => {
    await player(P1, "AAA");
    await player(P2, "BBB");
    const report = await repos.reports.create({
      reporterPlayerId: P2,
      reportedPlayerId: P1,
      reportedName: "AAA",
      reason: "offensive",
    });
    await test.db.delete(playersTable).where(eq(playersTable.id, P2));
    const still = await repos.reports.listPending(10);
    expect(still[0].id).toBe(report.id);
    expect(still[0].reporterPlayerId).toBeNull();
    // The report itself survives — the name is still held.
    expect(await repos.reports.hasPendingReport(P1)).toBe(true);
  });

  it("drops reports against a deleted player (ON DELETE cascade)", async () => {
    await player(P1, "AAA");
    await player(P2, "BBB");
    await repos.reports.create({ reporterPlayerId: P2, reportedPlayerId: P1, reportedName: "AAA", reason: "x" });
    await test.db.delete(playersTable).where(eq(playersTable.id, P1));
    expect(await repos.reports.listPending(10)).toEqual([]);
  });

  it("returns null when resolving an unknown report", async () => {
    expect(await repos.reports.resolve(4242, "cleared", "moderator")).toBeNull();
  });
});

describe("audit", () => {
  it("records entries and lists them newest first", async () => {
    await repos.audit.log({ actor: P1, action: "run.flagged", meta: { score: 1 } });
    await repos.audit.log({ actor: P2, action: "moderation.upheld", meta: { reportId: 1 } });
    const entries = await repos.audit.list(10);
    expect(entries.map((e) => e.action)).toEqual(["moderation.upheld", "run.flagged"]);
    expect(entries[0].actor).toBe(P2);
    expect(entries[0].at).toBeInstanceOf(Date);
  });

  it("honours the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await repos.audit.log({ actor: null, action: `run.flagged`, meta: { i } });
    }
    expect(await repos.audit.list(2)).toHaveLength(2);
  });

  it("accepts a null actor (system actions)", async () => {
    await repos.audit.log({ actor: null, action: "system.check", meta: null });
    const [entry] = await repos.audit.list(1);
    expect(entry.actor).toBeNull();
  });
});
