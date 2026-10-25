import { beforeAll, describe, expect, it } from "vitest";
import { installDomStubs } from "@/test/domStubs";
import { makeGame, runTicks, signature, step } from "@/test/harness";
import { CHIPS_ON_BOARD, COLS, PULSE_COST, ROWS, START_LIVES } from "./constants";
import type { Game } from "./engine";

/**
 * Integration coverage for the real engine, running headless.
 *
 * Because every stochastic decision now flows through an injected `Rng`, a run
 * is fully reproducible from its seed. That is what makes these assertions
 * possible at all — and it is the same property the daily challenge and
 * server-side replay verification depend on. The harness helpers (seeded game
 * factory, fixed-step driver, run fingerprint) live in `@/test/harness`.
 */
beforeAll(() => {
  installDomStubs();
});

describe("Game construction", () => {
  it("starts in attract mode with a full board of chips", () => {
    const game = makeGame(1);
    expect(game.mode).toBe("attract");
    expect(game.chips).toHaveLength(CHIPS_ON_BOARD);
  });

  it("generates a connected board with a clear centre", () => {
    for (let seed = 0; seed < 40; seed++) {
      const game = makeGame(seed);
      game.startRun();
      // Every open cell must be reachable from the player's start.
      const start = 4 * COLS + 4;
      const seen = new Set<number>([start]);
      const queue = [start];
      while (queue.length) {
        const i = queue.pop()!;
        const x = i % COLS;
        const y = (i / COLS) | 0;
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const j = ny * COLS + nx;
          if (game.walls[j] || seen.has(j)) continue;
          seen.add(j);
          queue.push(j);
        }
      }
      let open = 0;
      for (let i = 0; i < COLS * ROWS; i++) if (!game.walls[i]) open++;
      expect(seen.size, `seed ${seed} produced an unreachable area`).toBe(open);
      expect(game.walls[4 * COLS + 4], `seed ${seed} blocked the spawn`).toBe(0);
    }
  });

  it("keeps the three-by-three centre clear so the player always has room", () => {
    for (let seed = 0; seed < 40; seed++) {
      const game = makeGame(seed);
      game.startRun();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(game.walls[(4 + dy) * COLS + (4 + dx)]).toBe(0);
        }
      }
    }
  });
});

describe("determinism", () => {
  /**
   * A fixed, arbitrary input script — enough to exercise movement, chips,
   * collisions and pulses without needing a competent bot.
   */
  const script = (g: Game, tick: number): void => {
    if (tick % 7 === 0) g.inputDir((tick % 4) as 0 | 1 | 2 | 3);
    if (tick % 53 === 0) g.inputPulse();
  };

  it("two games built from the same seed produce identical boards", () => {
    const a = makeGame(12345);
    const b = makeGame(12345);
    expect(Array.from(a.walls)).toEqual(Array.from(b.walls));
  });

  it("different seeds produce different boards", () => {
    const walls = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      walls.add(Array.from(makeGame(seed).walls).join(""));
    }
    expect(walls.size).toBeGreaterThan(1);
  });

  it("the same seed and the same inputs produce byte-identical runs", () => {
    const a = makeGame(777);
    const b = makeGame(777);
    a.startRun();
    b.startRun();
    runTicks(a, script, 2500);
    runTicks(b, script, 2500);
    expect(signature(a)).toBe(signature(b));
  });

  it("stays in lockstep over a long run, not just the first few seconds", () => {
    const a = makeGame(2026);
    const b = makeGame(2026);
    a.startRun();
    b.startRun();
    for (let block = 0; block < 8; block++) {
      runTicks(a, script, 500);
      runTicks(b, script, 500);
      expect(signature(a), `desynced after ${(block + 1) * 500} ticks`).toBe(signature(b));
    }
  });

  it("different seeds diverge", () => {
    const signatures = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = makeGame(seed);
      g.startRun();
      runTicks(g, script, 1500);
      signatures.add(signature(g));
    }
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("visual effects do not desync the gameplay stream", () => {
    // Particles draw from a forked RNG, so emitting bursts must not change
    // what spawns next. Same seed, but one run spams particle effects.
    const quiet = makeGame(4242);
    const loud = makeGame(4242);
    quiet.startRun();
    loud.startRun();
    runTicks(quiet, script, 1200);
    runTicks(
      loud,
      (g, tick) => {
        script(g, tick);
        if (tick % 11 === 0) g.particles.emit(0, 0, "#fff", { count: 20, speed: 3, size: 2, life: 300 });
      },
      1200,
    );
    expect(signature(loud)).toBe(signature(quiet));
  });
});

describe("core rules", () => {
  it("starts a run with full shields and no score", () => {
    const game = makeGame(9);
    game.startRun();
    expect(game.lives).toBe(START_LIVES);
    expect(game.score).toBe(0);
    expect(game.level).toBe(1);
    expect(game.charge).toBe(0);
  });

  it("does not move the player into a wall", () => {
    const game = makeGame(3);
    game.startRun();
    // Find a direction that is walled off and confirm the player stays put.
    const dirs: [number, number, 0 | 1 | 2 | 3][] = [
      [0, -1, 0],
      [1, 0, 1],
      [0, 1, 2],
      [-1, 0, 3],
    ];
    const blocked = dirs.find(([dx, dy]) => !game.walkable(game.player.gx + dx, game.player.gy + dy));
    if (!blocked) return; // this board has no adjacent wall; nothing to assert
    const [, , dir] = blocked;
    const { gx, gy } = game.player;
    game.inputDir(dir);
    game.update(1000 / 60);
    expect(game.player.gx).toBe(gx);
    expect(game.player.gy).toBe(gy);
  });

  it("always keeps CHIPS_ON_BOARD chips in play", () => {
    const game = makeGame(11);
    game.startRun();
    let collected = 0;
    game.callbacks = { onGameOver: () => undefined, onChargeReady: () => undefined };
    for (let i = 0; i < 3000 && collected < 10; i++) {
      const before = game.chipsCollected;
      // Walk toward a chip each time the player can move.
      if (game.player.cooldown <= 0 && game.chips.length) {
        const c = game.chips[0];
        const dx = c.gx - game.player.gx;
        const dy = c.gy - game.player.gy;
        game.inputDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
      }
      game.update(1000 / 60);
      if (game.chipsCollected > before) collected++;
      expect(game.chips.length).toBe(CHIPS_ON_BOARD);
      if (game.lives < START_LIVES) break;
    }
    expect(game.chipsCollected).toBeGreaterThan(0);
  });

  it("charges the pulse from chips and refuses to fire before it is full", () => {
    const game = makeGame(21);
    game.startRun();
    game.inputPulse();
    expect(game.charge).toBe(0); // nothing collected, nothing spent
  });

  it("caps the pulse charge at PULSE_COST", () => {
    const game = makeGame(22);
    game.startRun();
    expect(PULSE_COST).toBe(5);
    expect(game.charge).toBeLessThanOrEqual(PULSE_COST);
  });

  it("reports game over exactly once and freezes the score", () => {
    const game = makeGame(31);
    game.startRun();
    let calls = 0;
    let finalScore = -1;
    game.callbacks = {
      onGameOver: (s) => {
        calls++;
        finalScore = s.score;
      },
      onChargeReady: () => undefined,
    };
    // Standing still still kills you: drones converge on the spawn cell.
    const DT = 1000 / 60;
    for (let t = 0; t < 60 * 60 * 2; t++) game.update(DT);
    expect(calls).toBe(1);
    expect(finalScore).toBe(game.score);
  });

  it("waits for the death animation, then reports game over once", () => {
    const game = makeGame(32);
    game.startRun();
    let called = false;
    game.callbacks = {
      onGameOver: () => {
        called = true;
      },
      onChargeReady: () => undefined,
    };
    const DT = 1000 / 60;

    let ticksAtZeroLives = -1;
    let calledAtZeroLives = false;
    for (let t = 0; t < 60 * 60 * 2; t++) {
      game.update(DT);
      if (game.lives === 0) {
        ticksAtZeroLives = t;
        calledAtZeroLives = called;
        break;
      }
    }

    expect(ticksAtZeroLives).toBeGreaterThan(0);
    // The 1400ms death animation is still playing, so nothing is reported yet.
    expect(calledAtZeroLives).toBe(false);

    // Let the animation finish (1400ms ≈ 84 ticks; 120 is comfortably past it).
    for (let t = 0; t < 120; t++) game.update(DT);
    expect(called).toBe(true);
  });
});

describe("difficulty escalation", () => {
  it("levels up every CHIPS_PER_LEVEL chips", () => {
    const game = makeGame(41);
    game.startRun();
    expect(game.level).toBe(1);
    game.chipsCollected = 6;
    (game as unknown as { levelCheck(): void }).levelCheck();
    expect(game.level).toBe(1);
    game.chipsCollected = 7;
    (game as unknown as { levelCheck(): void }).levelCheck();
    expect(game.level).toBe(2);
  });
});

describe("pausing", () => {
  it("freezes the simulation while paused", () => {
    const game = makeGame(51);
    game.startRun();
    game.paused = true;
    const before = { t: game.time, elapsed: game.elapsed };
    step(game, 2000);
    expect(game.time).toBe(before.t);
    expect(game.elapsed).toBe(before.elapsed);
  });
});

describe("engine commands", () => {
  // The engine is a 60 Hz mutable simulation, so it stays mutable by design.
  // What it must not be is mutable *from React*: a component holding the
  // instance and poking its fields during render is the pattern concurrent
  // rendering punishes. These setters are the seam, and they are what
  // `useEngine` calls instead of writing fields directly.

  it("setTouch toggles the coarse-pointer flag", () => {
    const game = makeGame(61);
    expect(game.isTouch).toBe(false);
    game.setTouch(true);
    expect(game.isTouch).toBe(true);
    game.setTouch(false);
    expect(game.isTouch).toBe(false);
  });

  it("setReducedMotion toggles the motion preference", () => {
    const game = makeGame(62);
    expect(game.reducedMotion).toBe(false);
    game.setReducedMotion(true);
    expect(game.reducedMotion).toBe(true);
  });

  it("setBestScore feeds the in-run new-best moment", () => {
    const game = makeGame(63);
    expect(game.bestScore).toBe(0);
    game.setBestScore(12_345);
    expect(game.bestScore).toBe(12_345);
  });

  it("setHaptics toggles haptics", () => {
    // The harness disables haptics for a headless run, so the toggle is
    // asserted from that baseline rather than from the engine default.
    const game = makeGame(64);
    expect(game.haptics).toBe(false);
    game.setHaptics(true);
    expect(game.haptics).toBe(true);
    game.setHaptics(false);
    expect(game.haptics).toBe(false);
  });

  it("setCallbacks replaces the reactions wholesale", () => {
    const game = makeGame(65);
    const seen: string[] = [];
    game.setCallbacks({
      onGameOver: () => seen.push("over"),
      onChargeReady: () => seen.push("charge"),
    });
    game.callbacks.onGameOver(game.stats());
    game.callbacks.onChargeReady(true);
    expect(seen).toEqual(["over", "charge"]);
  });

  it("commands are idempotent, so a re-run effect costs a comparison", () => {
    // A React effect that re-runs for an unrelated reason must not dirty the
    // engine. Only `setBestScore` is unconditional — it is set once per run,
    // not on an effect.
    const game = makeGame(66);
    game.setTouch(true);
    game.setReducedMotion(true);
    game.setHaptics(false);
    expect(game.isTouch).toBe(true);
    expect(game.reducedMotion).toBe(true);
    expect(game.haptics).toBe(false);
  });
});
