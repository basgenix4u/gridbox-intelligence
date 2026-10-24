import { bfs, chebyshev, manhattan } from "@/game/ai";
import { COLS, PULSE_COST, PULSE_RADIUS, ROWS } from "@/game/constants";
import type { Dir } from "@/game/types";
import type { Game } from "@/game/engine";
import type { BotPolicy } from "@/test/harness";
import { botRng } from "@/test/harness";
import type { Rng } from "@/core/ports/rng";

/**
 * Scripted bots for the headless harness.
 *
 * Two policies bracket the skill range the balance analysis needs: `greedyBot`
 * plays sensibly (collects chips, pathfinds with the engine's own BFS, flees
 * contact, pulses into clusters) and sits near the skill ceiling; `randomBot`
 * stumbles around and sits on the floor. The gap between them is the
 * risk/reward signal the teardown measures — and the distribution the
 * anti-cheat thresholds are calibrated against.
 */

const DIRS: readonly Dir[] = [0, 1, 2, 3];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

// Scratch buffers — the bots run serially, so one shared pair is safe.
const dist = new Int16Array(COLS * ROWS);
const queue = new Int32Array(COLS * ROWS);

function idx(x: number, y: number): number {
  return y * COLS + x;
}

function walkable(game: Game, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS && !game.walls[idx(x, y)];
}

/** Nearest-enemy step distance over the whole board (BFS from every enemy). */
function threatField(game: Game): number[] {
  const field = new Array<number>(COLS * ROWS).fill(Number.MAX_SAFE_INTEGER);
  const q: number[] = [];
  for (const e of game.enemies) {
    if (e.spawnAnim > 0) continue; // still telegraphing; not a threat yet
    const i = idx(e.gx, e.gy);
    if (field[i] > 0) {
      field[i] = 0;
      q.push(i);
    }
  }
  for (const i of q) {
    const x = i % COLS;
    const y = (i / COLS) | 0;
    const d = field[i] + 1;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (!walkable(game, nx, ny)) continue;
      const j = idx(nx, ny);
      if (d < field[j]) {
        field[j] = d;
        q.push(j);
      }
    }
  }
  return field;
}

/**
 * Skilled policy: flee contact first, pulse into clusters, otherwise collect
 * the nearest chip along a real path.
 */
export const greedyBot: BotPolicy = (game: Game) => {
  if (game.mode !== "playing") return;
  const px = game.player.gx;
  const py = game.player.gy;

  const threat = threatField(game);
  const here = threat[idx(px, py)];

  // 1. Contact imminent — step to the safest walkable neighbour.
  if (here <= 2) {
    let bestDir: Dir | null = null;
    let bestScore = -1;
    for (let k = 0; k < 4; k++) {
      const nx = px + DX[k];
      const ny = py + DY[k];
      if (!walkable(game, nx, ny)) continue;
      const safety = threat[idx(nx, ny)];
      // Prefer safety, then open space away from walls, then board centre.
      const openness = 4 - (manhattan(nx, ny, 4, 4) > 4 ? 1 : 0);
      const score = Math.min(safety, 6) * 10 + openness;
      if (score > bestScore) {
        bestScore = score;
        bestDir = DIRS[k];
      }
    }
    if (bestDir !== null) game.inputDir(bestDir);
    return;
  }

  // 2. Charged and enemies inside the pulse radius — purge.
  if (game.charge >= PULSE_COST) {
    for (const e of game.enemies) {
      if (e.spawnAnim > 0) continue;
      if (chebyshev(px, py, e.gx, e.gy) <= PULSE_RADIUS) {
        game.inputPulse();
        return;
      }
    }
  }

  // 3. Otherwise path to the nearest chip with the engine's own BFS.
  const sources: number[] = [];
  for (const c of game.chips) {
    if (walkable(game, c.gx, c.gy)) sources.push(idx(c.gx, c.gy));
  }
  if (sources.length === 0) return;
  bfs(game.walls, COLS, ROWS, sources, dist, queue);
  const hereDist = dist[idx(px, py)];
  if (hereDist < 0) return; // no chip reachable — hold position
  for (let k = 0; k < 4; k++) {
    const nx = px + DX[k];
    const ny = py + DY[k];
    if (!walkable(game, nx, ny)) continue;
    const d = dist[idx(nx, ny)];
    if (d >= 0 && d < hereDist) {
      game.inputDir(DIRS[k]);
      return;
    }
  }
};

/** Floor policy: stumbles randomly, pulses when it happens to be charged. */
export function randomBot(seed: number): BotPolicy {
  const rng: Rng = botRng(seed);
  let cooldown = 0;
  return (game: Game) => {
    if (game.mode !== "playing") return;
    if (cooldown > 0) {
      cooldown--;
      return;
    }
    const roll = rng.next();
    if (game.charge >= PULSE_COST && roll < 0.05) {
      game.inputPulse();
    } else if (roll < 0.8) {
      game.inputDir(DIRS[rng.int(4)]);
      cooldown = 3 + rng.int(6);
    }
  };
}
