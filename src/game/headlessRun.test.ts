import { beforeAll, describe, expect, it } from "vitest";
import { installDomStubs } from "@/test/domStubs";
import { greedyBot, randomBot } from "@/test/bots";
import { MAX_RUN_TICKS, median, percentile, runToGameOver, signature } from "@/test/harness";
import { HARNESS_SCORE_PER_SECOND_P99, SUSPECT_SCORE_PER_SECOND } from "@/shared/calibration";
import { MAX_COMBO, START_LIVES } from "./constants";
import type { RunStats } from "./types";

/**
 * Stage 3.6 — deterministic headless runs to game-over.
 *
 * The in-repo successor of the external balance harness (teardown §3): the
 * real engine, a seeded RNG, scripted bots, fixed 60 fps ticks. These tests
 * pin the properties everything downstream depends on — replayability, run
 * termination, structural bounds, the skill floor/ceiling gap, and the
 * distribution the anti-cheat thresholds are calibrated against.
 */
beforeAll(() => {
  installDomStubs();
});

interface RunSummary {
  seed: number;
  stats: RunStats;
  ticks: number;
  terminated: boolean;
  sig: string;
  /** Score per second of survival — the anti-cheat plausibility signal. */
  scorePerSecond: number;
}

function summarise(seed: number): RunSummary {
  const run = runToGameOver(seed, greedyBot);
  const seconds = run.stats.timeMs / 1000;
  return {
    seed,
    stats: run.stats,
    ticks: run.ticks,
    terminated: run.terminated,
    sig: signature(run.game),
    scorePerSecond: seconds > 0 ? run.stats.score / seconds : 0,
  };
}

// 60 seeded skilled runs, computed once and shared by the distribution tests.
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
let skilled: RunSummary[];

beforeAll(() => {
  skilled = SEEDS.map(summarise);
}, 120_000);

describe("deterministic headless runs", () => {
  it("replays identically from the same seed", () => {
    const a = runToGameOver(7, greedyBot);
    const b = runToGameOver(7, greedyBot);
    expect(signature(b.game)).toBe(signature(a.game));
    expect(b.stats).toEqual(a.stats);
    expect(b.ticks).toBe(a.ticks);
  });

  it("produces different runs for different seeds", () => {
    const a = runToGameOver(1, greedyBot);
    const b = runToGameOver(2, greedyBot);
    expect(signature(b.game)).not.toBe(signature(a.game));
  });

  it("runs to game-over and reports coherent stats", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = runToGameOver(seed, greedyBot);
      expect(run.terminated, `seed ${seed} hit the safety cap`).toBe(true);
      expect(run.game.mode).toBe("dead");
      expect(run.gameOvers).toBe(1);
      expect(run.ticks).toBeLessThan(MAX_RUN_TICKS);
      expect(run.stats.timeMs).toBeGreaterThan(0);
      expect(run.stats.level).toBeGreaterThanOrEqual(1);
      expect(run.stats.maxCombo).toBeGreaterThanOrEqual(1);
      expect(run.stats.maxCombo).toBeLessThanOrEqual(MAX_COMBO);
      expect(run.stats.kills).toBeGreaterThanOrEqual(0);
      expect(run.stats.chips).toBeGreaterThanOrEqual(0);
      expect(run.stats.score).toBeGreaterThanOrEqual(0);
      expect(run.game.lives).toBeGreaterThanOrEqual(0);
      expect(run.game.lives).toBeLessThanOrEqual(START_LIVES);
    }
  });
});

describe("balance envelope", () => {
  it("every skilled run terminates within the safety cap", () => {
    const capped = skilled.filter((r) => !r.terminated);
    expect(capped.map((r) => r.seed)).toEqual([]);
  });

  it("keeps every run inside the engine's structural bounds", () => {
    for (const run of skilled) {
      expect(run.stats.maxCombo).toBeLessThanOrEqual(MAX_COMBO);
      expect(run.stats.level).toBeLessThanOrEqual(40);
      expect(run.stats.score).toBeLessThan(200_000);
      expect(Number.isFinite(run.scorePerSecond)).toBe(true);
    }
  });

  it("the skilled bot dramatically outscores the random bot", () => {
    const random = SEEDS.map((seed) => {
      const run = runToGameOver(seed, randomBot(seed));
      return { score: run.stats.score, level: run.stats.level };
    });
    const randomScores = random.map((r) => r.score);
    const randomLevels = random.map((r) => r.level);
    const skilledScores = skilled.map((r) => r.stats.score);
    const skilledLevels = skilled.map((r) => r.stats.level);

    expect(median(skilledScores)).toBeGreaterThan(2000);
    expect(median(randomScores)).toBeLessThan(700);
    expect(median(skilledScores)).toBeGreaterThan(median(randomScores) * 5);
    expect(median(skilledLevels)).toBeGreaterThanOrEqual(5);
    expect(median(randomLevels)).toBeLessThanOrEqual(3);
  }, 120_000);
});

describe("anti-cheat baseline", () => {
  it("score-per-second has a stable, finite distribution across seeds", () => {
    const rates = skilled.map((r) => r.scorePerSecond);
    for (const rate of rates) {
      expect(rate).toBeGreaterThan(0);
      expect(Number.isFinite(rate)).toBe(true);
    }
    const p99 = percentile(rates, 99);
    // Drift guard: the server's suspect threshold is calibrated to this
    // measurement. If the engine or the bots got faster, the constant in
    // src/shared/calibration.ts is stale and must be re-derived — fail here
    // rather than silently flagging (or passing) the wrong runs.
    expect(p99).toBeLessThanOrEqual(HARNESS_SCORE_PER_SECOND_P99);
    // And it must not be absurdly slower either, or the filter is toothless.
    expect(p99).toBeGreaterThan(HARNESS_SCORE_PER_SECOND_P99 * 0.5);
    expect(SUSPECT_SCORE_PER_SECOND).toBe(304);
  });

  it("the distribution is reproducible — same seeds, same numbers", () => {
    const again = SEEDS.slice(0, 10).map(summarise);
    for (let i = 0; i < again.length; i++) {
      expect(again[i].stats).toEqual(skilled[i].stats);
      expect(again[i].scorePerSecond).toBe(skilled[i].scorePerSecond);
    }
  }, 60_000);
});
