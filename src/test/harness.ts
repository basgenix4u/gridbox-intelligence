import { createRng } from "@/core/adapters/seededRng";
import type { Rng } from "@/core/ports/rng";
import { createSilentAudio } from "@/core/adapters/silentAudio";
import { Game } from "@/game/engine";
import type { RunStats } from "@/game/types";

/**
 * The hardened headless harness.
 *
 * This is the in-repo successor of the external Node balance harness described
 * in `docs/PRODUCT-TEARDOWN.md §3`: it drives the *real* engine with a seeded
 * RNG and scripted bots at a fixed 60 fps tick, so a run is fully reproducible
 * from its seed. The daily challenge, the balance analysis and (later)
 * server-side replay verification all rest on this property.
 */

export const DT = 1000 / 60;
/** Safety cap: 500 s of game time. No run should ever reach it. */
export const MAX_RUN_TICKS = 30_000;

export function makeGame(seed: number): Game {
  const game = new Game(createSilentAudio(), createRng(seed));
  game.resize(360, 640, 1);
  game.haptics = false;
  return game;
}

/** Advances the simulation by fixed 60fps steps. */
export function step(game: Game, ms: number): void {
  for (let t = 0; t < ms; t += DT) game.update(DT);
}

/** Advances `ticks` fixed 60fps steps, applying `policy` before each update. */
export function runTicks(game: Game, policy: (g: Game, tick: number) => void, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    policy(game, t);
    game.update(DT);
  }
}

/** A cheap fingerprint of everything a run is made of. */
export function signature(game: Game): string {
  return JSON.stringify({
    score: game.score,
    chips: game.chipsCollected,
    level: game.level,
    lives: game.lives,
    kills: game.kills,
    combo: game.combo,
    maxCombo: game.maxCombo,
    charge: game.charge,
    px: game.player.gx,
    py: game.player.gy,
    enemies: game.enemies.map((e) => [e.kind, e.gx, e.gy]),
    spawners: game.spawners.map((s) => [s.kind, s.gx, s.gy]),
    chipPos: game.chips.map((c) => [c.gx, c.gy]),
    walls: Array.from(game.walls),
  });
}

/** A scripted decision, applied before each engine tick. */
export type BotPolicy = (game: Game, tick: number) => void;

export interface RunResult {
  game: Game;
  stats: RunStats;
  ticks: number;
  /** How many times the game-over callback fired — must be exactly 1. */
  gameOvers: number;
  /** True when the run ended in death rather than hitting the safety cap. */
  terminated: boolean;
}

/** Drives one seeded run under `policy` until the game-over callback fires or the cap hits. */
export function runToGameOver(seed: number, policy: BotPolicy, maxTicks = MAX_RUN_TICKS): RunResult {
  const game = makeGame(seed);
  let gameOvers = 0;
  game.callbacks.onGameOver = () => {
    gameOvers++;
  };
  game.startRun();
  let tick = 0;
  // The engine delays the game-over callback by a short death beat after the
  // player dies, so keep ticking until it fires — a run is only "over" once
  // the product has actually reported it.
  while (tick < maxTicks && (game.mode !== "dead" || gameOvers === 0)) {
    policy(game, tick);
    game.update(DT);
    tick++;
  }
  return { game, stats: game.stats(), ticks: tick, gameOvers, terminated: game.mode === "dead" };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Deterministic random source for bots, so "random" play is reproducible too. */
export function botRng(seed: number): Rng {
  return createRng(seed ^ 0x5f3759df);
}
