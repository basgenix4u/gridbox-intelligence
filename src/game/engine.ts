import {
  CHIPS_ON_BOARD,
  CHIPS_PER_LEVEL,
  COLORS,
  COLS,
  COMBO_WINDOW,
  HOLD_FIRST,
  HOLD_REPEAT,
  INVULN_MS,
  KINDS,
  KIND_UNLOCK_LEVEL,
  MAX_COMBO,
  MOVE_COOLDOWN,
  PRED_WINDOW,
  PULSE_COST,
  PULSE_RADIUS,
  ROWS,
  SPAWN_TELEGRAPH,
  START_LIVES,
  kindWeights,
  levelMaxEnemies,
  levelPeriod,
  levelSpawnEvery,
} from "./constants";
import { bfs, chebyshev, manhattan } from "./ai";
import { ParticleSystem } from "./particles";
import { createRng } from "@/core/adapters/seededRng";
import type { AudioSink } from "@/core/ports/audio";
import type { Rng } from "@/core/ports/rng";
import { SpriteCache } from "./sprites";
import {
  DIRS,
  DX,
  DY,
  type Banner,
  type Chip,
  type Dir,
  type Enemy,
  type GameMode,
  type Ghost,
  type Layout,
  type Player,
  type Popup,
  type Ring,
  type RunStats,
  type Spawner,
} from "./types";

export interface GameCallbacks {
  onGameOver(stats: RunStats): void;
  onChargeReady(ready: boolean): void;
}

const N = COLS * ROWS;

export class Game {
  readonly cols = COLS;
  readonly rows = ROWS;
  walls = new Uint8Array(N);
  player: Player;
  enemies: Enemy[] = [];
  chips: Chip[] = [];
  spawners: Spawner[] = [];
  popups: Popup[] = [];
  rings: Ring[] = [];
  ghosts: Ghost[] = [];
  particles: ParticleSystem;
  /** Seeded source of every gameplay decision. See `createRng`. */
  readonly rng: Rng;
  banner: Banner | null = null;
  sprites = new SpriteCache();
  audio: AudioSink;

  mode: GameMode = "attract";
  paused = false;
  isTouch = false;
  reducedMotion = false;
  haptics = true;
  /** Best score from the local table — used for the in-run "NEW BEST" moment. */
  bestScore = 0;
  private beatBest = false;

  // run state
  score = 0;
  combo = 1;
  comboTimer = 0;
  maxCombo = 1;
  chipsCollected = 0;
  level = 1;
  lives = START_LIVES;
  charge = 0;
  kills = 0;
  elapsed = 0;

  // juice
  trauma = 0;
  timeScale = 1;
  hitstop = 0;
  flash = { r: 255, g: 255, b: 255, a: 0 };
  comboPop = 0;
  chargePop = 0;
  chargeDeny = 0;
  livesPop = 0;
  pulseFlash = 0;
  time = 0;

  // timers
  private spawnTimer = 0;
  private deathTimer = 0;
  private autopilotTimer = 0;
  private reported = false;
  private nextId = 1;
  private chargeReady = false;

  // input
  private heldStack: Dir[] = [];
  private holdTimer = 0;

  // distance fields
  distPlayer = new Int16Array(N);
  distPred = new Int16Array(N);
  distChips = new Int16Array(N);
  private queue = new Int32Array(N);
  private fieldsDirty = true;
  private predIdx = -1;

  layout: Layout = { W: 320, H: 420, cell: 32, ox: 10, oy: 70, hudH: 60, botH: 30, pad: 10, dpr: 1 };
  callbacks: GameCallbacks = {
    onGameOver: () => undefined,
    onChargeReady: () => undefined,
  };

  constructor(audio: AudioSink, rng: Rng = createRng()) {
    this.audio = audio;
    this.rng = rng;
    // FX get a forked stream, so particle churn can never desync gameplay.
    this.particles = new ParticleSystem(rng.fork(0x9e3779b9));
    this.player = this.makePlayer();
    this.startAttract();
  }

  // ------------------------------------------------------------ lifecycle

  startRun(): void {
    this.reset("playing");
  }

  startAttract(): void {
    this.reset("attract");
  }

  private makePlayer(): Player {
    return {
      gx: 4,
      gy: 4,
      vx: 4,
      vy: 4,
      facing: 0,
      cooldown: 0,
      buffered: -1,
      invuln: 0,
      sx: 1,
      sy: 1,
      bumpX: 0,
      bumpY: 0,
      lastMoveAt: -9999,
    };
  }

  private reset(mode: GameMode): void {
    this.mode = mode;
    this.paused = false;
    this.generateWalls();
    this.player = this.makePlayer();
    this.enemies = [];
    this.chips = [];
    this.spawners = [];
    this.popups = [];
    this.rings = [];
    this.ghosts = [];
    this.particles.clear();
    this.banner = null;

    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.maxCombo = 1;
    this.chipsCollected = 0;
    this.level = 1;
    this.lives = START_LIVES;
    this.charge = 0;
    this.kills = 0;
    this.elapsed = 0;

    this.trauma = 0;
    this.timeScale = 1;
    this.hitstop = 0;
    this.flash.a = 0;
    this.comboPop = 0;
    this.chargePop = 0;
    this.chargeDeny = 0;
    this.livesPop = 0;
    this.pulseFlash = 0;

    this.spawnTimer = mode === "attract" ? 300 : 900;
    this.deathTimer = 0;
    this.autopilotTimer = 0;
    this.reported = false;
    this.beatBest = false;
    this.heldStack = [];
    this.holdTimer = 0;
    this.fieldsDirty = true;
    this.predIdx = -1;

    for (let i = 0; i < CHIPS_ON_BOARD; i++) this.spawnChip();

    this.audio.gameSounds = mode !== "attract";
    this.sprites.buildStatic(this.layout, this.walls, COLS, ROWS);
    this.setChargeReady(false);
    if (mode === "playing") {
      this.banner = { title: "SYSTEM ONLINE", sub: "HARVEST THE CHIPS", t: 0, life: 1500, color: COLORS.player };
      this.flash = { r: 34, g: 211, b: 238, a: 0.16 };
    }
  }

  private buzz(pattern: number | number[]): void {
    if (!this.haptics || this.mode !== "playing") return;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }

  private checkBest(): void {
    if (this.beatBest || this.mode !== "playing" || this.bestScore <= 0 || this.score <= this.bestScore) return;
    this.beatBest = true;
    this.addPopup(this.player.gx, this.player.gy - 1.1, "NEW BEST!", COLORS.chip, 15);
    this.flash = { r: 251, g: 191, b: 36, a: 0.14 };
    this.trauma = Math.max(this.trauma, 0.2);
    this.audio.ready();
  }

  resize(availW: number, availH: number, dpr: number): void {
    const pad = 10;
    const cellW = Math.floor((availW - pad * 2) / COLS);
    const cellH = Math.floor((availH - 66 - pad * 2) / (ROWS + 0.65));
    const cell = Math.max(20, Math.min(64, cellW, cellH));
    const hudH = Math.round(44 + cell * 0.45);
    const botH = Math.round(22 + cell * 0.2);
    this.layout = {
      W: COLS * cell + pad * 2,
      H: hudH + pad * 2 + ROWS * cell + botH,
      cell,
      ox: pad,
      oy: hudH + pad,
      hudH,
      botH,
      pad,
      dpr,
    };
    this.sprites.buildStatic(this.layout, this.walls, COLS, ROWS);
    this.sprites.buildVignette(this.layout);
    this.sprites.clearGlows();
  }

  stats(): RunStats {
    return {
      score: this.score,
      level: this.level,
      chips: this.chipsCollected,
      maxCombo: this.maxCombo,
      kills: this.kills,
      timeMs: this.elapsed,
    };
  }

  get effLevel(): number {
    return this.mode === "attract" ? Math.min(this.level, 3) : this.level;
  }

  // ------------------------------------------------------------ board generation

  private generateWalls(): void {
    const w = this.walls;
    for (let attempt = 0; attempt < 60; attempt++) {
      w.fill(0);
      const pairs = 4 + this.rng.int(2);
      let placed = 0;
      let guard = 0;
      while (placed < pairs && guard++ < 300) {
        const x = 1 + this.rng.int(4); // left half (mirrored)
        const y = 1 + this.rng.int(7);
        if (Math.abs(x - 4) <= 1 && Math.abs(y - 4) <= 1) continue; // keep the center clear
        const i = y * COLS + x;
        const j = y * COLS + (COLS - 1 - x);
        if (w[i]) continue;
        w[i] = 1;
        w[j] = 1;
        placed++;
      }
      if (this.connected()) return;
    }
    w.fill(0);
  }

  private connected(): boolean {
    bfs(this.walls, COLS, ROWS, [4 * COLS + 4], this.distPlayer, this.queue);
    for (let i = 0; i < N; i++) if (!this.walls[i] && this.distPlayer[i] < 0) return false;
    return true;
  }

  walkable(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS && !this.walls[y * COLS + x];
  }

  private chipAt(x: number, y: number): boolean {
    for (const c of this.chips) if (c.gx === x && c.gy === y) return true;
    return false;
  }

  private enemyAt(x: number, y: number): boolean {
    for (const e of this.enemies) if (!e.dead && e.gx === x && e.gy === y) return true;
    return false;
  }

  private spawnerAt(x: number, y: number): boolean {
    for (const s of this.spawners) if (s.gx === x && s.gy === y) return true;
    return false;
  }

  private spawnChip(): void {
    const p = this.player;
    const good: number[] = [];
    const any: number[] = [];
    for (let i = 0; i < N; i++) {
      if (this.walls[i]) continue;
      const x = i % COLS;
      const y = (i / COLS) | 0;
      if ((x === p.gx && y === p.gy) || this.chipAt(x, y) || this.enemyAt(x, y) || this.spawnerAt(x, y)) continue;
      any.push(i);
      const d = manhattan(x, y, p.gx, p.gy);
      if (d >= 2 && d <= 7) good.push(i);
    }
    const pool = good.length ? good : any;
    if (!pool.length) return;
    const i = this.rng.pick(pool);
    this.chips.push({ gx: i % COLS, gy: (i / COLS) | 0, phase: this.rng.range(0, Math.PI * 2), anim: 0 });
    this.fieldsDirty = true;
  }

  private addSpawner(): void {
    const p = this.player;
    const cands: number[] = [];
    for (let i = 0; i < N; i++) {
      const x = i % COLS;
      const y = (i / COLS) | 0;
      if (x !== 0 && y !== 0 && x !== COLS - 1 && y !== ROWS - 1) continue;
      if (this.walls[i] || this.enemyAt(x, y) || this.spawnerAt(x, y) || this.chipAt(x, y)) continue;
      if (manhattan(x, y, p.gx, p.gy) < 3) continue;
      cands.push(i);
    }
    if (!cands.length) return;
    const i = this.rng.pick(cands);
    this.spawners.push({ gx: i % COLS, gy: (i / COLS) | 0, kind: this.pickKind(), t: 0, total: SPAWN_TELEGRAPH });
  }

  private pickKind(): number {
    const w = kindWeights(this.effLevel);
    let r = this.rng.next();
    for (let k = 0; k < w.length; k++) {
      r -= w[k];
      if (r <= 0) return k;
    }
    return 0;
  }

  private spawnEnemy(s: Spawner): void {
    const period = levelPeriod(this.effLevel) * KINDS[s.kind].speed;
    this.enemies.push({
      id: this.nextId++,
      kind: s.kind,
      gx: s.gx,
      gy: s.gy,
      vx: s.gx,
      vy: s.gy,
      timer: period,
      period,
      intent: -1,
      spawnAnim: 0,
      sx: 1,
      sy: 1,
      dead: false,
      seed: this.rng.range(0, Math.PI * 2),
    });
    this.burst(s.gx, s.gy, 10, KINDS[s.kind].color, 3.5, this.layout.cell * 0.1, 400);
    this.audio.spawn();
  }

  // ------------------------------------------------------------ input

  inputDir(dir: Dir): void {
    if (this.paused || this.mode === "dead") return;
    if (this.player.cooldown <= 0) this.move(dir);
    else this.player.buffered = dir;
  }

  setHeld(dir: Dir, held: boolean): void {
    const i = this.heldStack.indexOf(dir);
    if (held) {
      if (i >= 0) this.heldStack.splice(i, 1);
      this.heldStack.push(dir);
      this.holdTimer = HOLD_REPEAT - HOLD_FIRST;
      this.inputDir(dir);
    } else if (i >= 0) {
      this.heldStack.splice(i, 1);
    }
  }

  clearHeld(): void {
    this.heldStack.length = 0;
    this.player.buffered = -1;
  }

  inputPulse(): void {
    if (this.paused || this.mode === "dead") return;
    this.pulse();
  }

  // ------------------------------------------------------------ update

  update(dt: number): void {
    if (this.paused) return;
    const real = dt;
    this.time += real;
    const dtFx = real * this.timeScale;
    let dtw = dtFx;
    if (this.hitstop > 0) {
      this.hitstop -= real;
      dtw = 0;
    }
    if (this.mode !== "dead" && this.timeScale < 1) this.timeScale = Math.min(1, this.timeScale + real * 0.0028);
    else if (this.mode === "dead" && this.timeScale < 0.6)
      this.timeScale = Math.min(0.6, this.timeScale + real * 0.00028);
    this.trauma = Math.max(0, this.trauma - real * 0.0021);
    if (this.flash.a > 0) this.flash.a = Math.max(0, this.flash.a - real * 0.0035);
    this.comboPop = Math.max(0, this.comboPop - real * 0.004);
    this.chargePop = Math.max(0, this.chargePop - real * 0.004);
    this.chargeDeny = Math.max(0, this.chargeDeny - real * 0.004);
    this.livesPop = Math.max(0, this.livesPop - real * 0.003);
    this.pulseFlash = Math.max(0, this.pulseFlash - real * 0.003);
    if (this.banner) {
      this.banner.t += real;
      if (this.banner.t >= this.banner.life) this.banner = null;
    }
    if (this.mode === "playing") this.elapsed += real;

    // ---- player
    const p = this.player;
    if (this.mode !== "dead") {
      p.cooldown -= real;
      if (this.heldStack.length) this.holdTimer += real;
      if (p.cooldown <= 0) {
        if (p.buffered !== -1) {
          const d: Dir = p.buffered;
          p.buffered = -1;
          this.move(d);
        } else if (this.heldStack.length && this.holdTimer >= HOLD_REPEAT) {
          this.holdTimer = 0;
          this.move(this.heldStack[this.heldStack.length - 1]);
        }
      }
      if (this.mode === "attract") this.autopilot(dtw);
    }
    const kp = 1 - Math.exp(-real * 0.022);
    p.vx += (p.gx - p.vx) * kp;
    p.vy += (p.gy - p.vy) * kp;
    const ks = 1 - Math.exp(-real * 0.013);
    p.sx += (1 - p.sx) * ks;
    p.sy += (1 - p.sy) * ks;
    const kb = Math.exp(-real * 0.018);
    p.bumpX *= kb;
    p.bumpY *= kb;
    p.invuln = Math.max(0, p.invuln - dtw);

    // ---- combo decay
    if (this.combo > 1 && this.mode !== "dead") {
      this.comboTimer -= dtw;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.comboTimer = 0;
      }
    }

    // ---- spawning
    if (dtw > 0) {
      for (let i = this.spawners.length - 1; i >= 0; i--) {
        const s = this.spawners[i];
        s.t += dtw;
        if (s.t >= s.total) {
          if (s.gx === p.gx && s.gy === p.gy) continue;
          this.spawnEnemy(s);
          this.spawners.splice(i, 1);
        }
      }
      if (this.mode !== "dead" && this.enemies.length + this.spawners.length < levelMaxEnemies(this.effLevel)) {
        this.spawnTimer -= dtw;
        if (this.spawnTimer <= 0) {
          this.addSpawner();
          this.spawnTimer = levelSpawnEvery(this.effLevel);
        }
      }
    }

    // ---- enemies
    this.updateEnemies(dtw, real);

    // ---- fx
    for (const c of this.chips) {
      c.phase += dtFx * 0.004;
      c.anim = Math.min(1, c.anim + real * 0.005);
    }
    this.particles.update(dtFx);
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pp = this.popups[i];
      pp.t += dtFx;
      if (pp.t >= pp.life) this.popups.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dtFx;
      if (r.t >= r.life) this.rings.splice(i, 1);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += real;
      if (g.t >= 260) this.ghosts.splice(i, 1);
    }

    // ---- death
    if (this.mode === "dead" && !this.reported) {
      this.deathTimer -= real;
      if (this.deathTimer <= 0) {
        this.reported = true;
        this.callbacks.onGameOver(this.stats());
      }
    }
  }

  private updateEnemies(dtw: number, real: number): void {
    const p = this.player;
    let anyDead = false;
    for (const e of this.enemies) {
      if (e.dead) {
        anyDead = true;
        continue;
      }
      e.spawnAnim = Math.min(1, e.spawnAnim + real * 0.005);
      if (dtw > 0) {
        e.timer -= dtw;
        const win = Math.min(320, e.period * 0.6);
        if (e.intent < 0 && e.timer <= win) e.intent = this.decide(e);
        if (e.timer <= 0) {
          let d: Dir | -1 = e.intent;
          if (d < 0 || !this.canEnter(e, e.gx + DX[d], e.gy + DY[d])) d = this.decide(e);
          if (d >= 0) {
            e.gx += DX[d];
            e.gy += DY[d];
            if (DX[d] !== 0) {
              e.sx = 1.3;
              e.sy = 0.75;
            } else {
              e.sx = 0.75;
              e.sy = 1.3;
            }
          }
          e.intent = -1;
          e.timer = Math.max(e.period * 0.4, e.timer + e.period);
          if (e.gx === p.gx && e.gy === p.gy) this.hitPlayer(e);
          if (e.dead) {
            anyDead = true;
            continue;
          }
        }
      }
      const k = 1 - Math.exp(-real * 0.016);
      e.vx += (e.gx - e.vx) * k;
      e.vy += (e.gy - e.vy) * k;
      const ks = 1 - Math.exp(-real * 0.012);
      e.sx += (1 - e.sx) * ks;
      e.sy += (1 - e.sy) * ks;
    }
    if (anyDead) this.enemies = this.enemies.filter((e) => !e.dead);
  }

  // ------------------------------------------------------------ AI

  private canEnter(e: Enemy, x: number, y: number): boolean {
    if (!this.walkable(x, y)) return false;
    if (this.player.invuln > 0 && x === this.player.gx && y === this.player.gy) return false;
    for (const o of this.enemies) if (o !== e && !o.dead && o.gx === x && o.gy === y) return false;
    for (const s of this.spawners) if (s.gx === x && s.gy === y) return false;
    return true;
  }

  private decide(e: Enemy): Dir | -1 {
    const cands: Dir[] = [];
    for (const d of DIRS) if (this.canEnter(e, e.gx + DX[d], e.gy + DY[d])) cands.push(d);
    if (!cands.length) return -1;
    const p = this.player;
    switch (e.kind) {
      case 0: // drone: half random, half greedy
        if (this.rng.chance(0.45)) return this.rng.pick(cands);
        return this.pickBest(cands, e, (x, y) => manhattan(x, y, p.gx, p.gy));
      case 1: // hunter: greedy straight-line chase
        return this.pickBest(cands, e, (x, y) => manhattan(x, y, p.gx, p.gy));
      case 2: {
        // mind: true shortest path
        this.ensureFields();
        return this.pickBest(cands, e, (x, y) => {
          const v = this.distPlayer[y * COLS + x];
          return v < 0 ? 99 : v;
        });
      }
      default: {
        // oracle: shortest path to where the player is heading
        this.ensurePred();
        return this.pickBest(cands, e, (x, y) => {
          const v = this.distPred[y * COLS + x];
          return v < 0 ? 99 : v;
        });
      }
    }
  }

  private pickBest(cands: Dir[], e: Enemy, cost: (x: number, y: number) => number): Dir {
    let best = Infinity;
    let count = 0;
    let chosen: Dir = cands[0];
    for (const d of cands) {
      const c = cost(e.gx + DX[d], e.gy + DY[d]);
      if (c < best - 1e-9) {
        best = c;
        count = 1;
        chosen = d;
      } else if (Math.abs(c - best) < 1e-9) {
        // reservoir sampling among ties
        count++;
        if (this.rng.chance(1 / count)) chosen = d;
      }
    }
    return chosen;
  }

  private ensureFields(): void {
    if (!this.fieldsDirty) return;
    const p = this.player;
    bfs(this.walls, COLS, ROWS, [p.gy * COLS + p.gx], this.distPlayer, this.queue);
    if (this.mode === "attract") {
      bfs(
        this.walls,
        COLS,
        ROWS,
        this.chips.map((c) => c.gy * COLS + c.gx),
        this.distChips,
        this.queue,
      );
    }
    this.fieldsDirty = false;
  }

  private ensurePred(): void {
    const p = this.player;
    let tx = p.gx;
    let ty = p.gy;
    if (this.time - p.lastMoveAt < PRED_WINDOW) {
      const nx = p.gx + DX[p.facing];
      const ny = p.gy + DY[p.facing];
      if (this.walkable(nx, ny)) {
        tx = nx;
        ty = ny;
      }
    }
    const idx = ty * COLS + tx;
    if (idx !== this.predIdx) {
      this.predIdx = idx;
      bfs(this.walls, COLS, ROWS, [idx], this.distPred, this.queue);
    }
  }

  /** Attract-mode autopilot: head for the nearest chip while avoiding threats. */
  private autopilot(dt: number): void {
    this.autopilotTimer -= dt;
    const p = this.player;
    if (this.autopilotTimer > 0 || p.cooldown > 0) return;
    this.autopilotTimer = this.rng.range(150, 240);
    this.ensureFields();

    const danger = (x: number, y: number): number => {
      let v = 0;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = manhattan(x, y, e.gx, e.gy);
        if (d === 0) v += 60;
        else if (d === 1) v += 10;
        else if (d === 2) v += 1.5;
        if (e.intent >= 0 && e.gx + DX[e.intent] === x && e.gy + DY[e.intent] === y) v += 25;
      }
      for (const s of this.spawners) if (s.gx === x && s.gy === y && s.t / s.total > 0.5) v += 30;
      return v;
    };
    const value = (x: number, y: number): number => {
      const d = this.distChips[y * COLS + x];
      return (d < 0 ? 99 : d) + danger(x, y);
    };

    const stay = value(p.gx, p.gy) + 0.3;
    let bestV = Infinity;
    let bestD: Dir | -1 = -1;
    for (const d of DIRS) {
      const nx = p.gx + DX[d];
      const ny = p.gy + DY[d];
      if (!this.walkable(nx, ny)) continue;
      const v = value(nx, ny) + this.rng.range(0, 0.2);
      if (v < bestV) {
        bestV = v;
        bestD = d;
      }
    }
    if (bestD !== -1 && bestV < stay) this.move(bestD);

    if (this.charge >= PULSE_COST) {
      let n = 0;
      for (const e of this.enemies) if (!e.dead && chebyshev(e.gx, e.gy, p.gx, p.gy) <= PULSE_RADIUS) n++;
      if (n >= 2 || (n === 1 && this.rng.chance(0.25))) this.pulse();
    }
  }

  // ------------------------------------------------------------ actions

  private move(dir: Dir): void {
    const p = this.player;
    p.facing = dir;
    const nx = p.gx + DX[dir];
    const ny = p.gy + DY[dir];
    p.cooldown = MOVE_COOLDOWN;
    if (!this.walkable(nx, ny)) {
      p.bumpX = DX[dir] * 0.14;
      p.bumpY = DY[dir] * 0.14;
      if (DX[dir] !== 0) {
        p.sx = 0.8;
        p.sy = 1.18;
      } else {
        p.sx = 1.18;
        p.sy = 0.8;
      }
      this.trauma = Math.max(this.trauma, 0.08);
      this.audio.bump();
      return;
    }
    this.ghosts.push({ x: p.vx, y: p.vy, t: 0 });
    if (this.ghosts.length > 10) this.ghosts.shift();
    p.gx = nx;
    p.gy = ny;
    p.lastMoveAt = this.time;
    if (DX[dir] !== 0) {
      p.sx = 1.28;
      p.sy = 0.78;
    } else {
      p.sx = 0.78;
      p.sy = 1.28;
    }
    this.fieldsDirty = true;
    this.audio.move();

    for (let i = 0; i < this.chips.length; i++) {
      const c = this.chips[i];
      if (c.gx === nx && c.gy === ny) {
        this.collectChip(i);
        break;
      }
    }
    for (const e of this.enemies) {
      if (!e.dead && e.gx === nx && e.gy === ny) {
        this.hitPlayer(e);
        break;
      }
    }
  }

  private collectChip(i: number): void {
    const c = this.chips[i];
    this.chips.splice(i, 1);
    const cell = this.layout.cell;
    const gained = 10 * this.combo;
    this.score += gained;
    this.chipsCollected++;
    this.comboTimer = COMBO_WINDOW;
    this.comboPop = 1;
    this.addPopup(c.gx, c.gy, `+${gained}`, COLORS.chip, 14);
    this.audio.collect(this.combo);
    this.combo = Math.min(MAX_COMBO, this.combo + 1);
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.burst(c.gx, c.gy, 16, COLORS.chip, 4.5, cell * 0.12, 520);
    this.burst(c.gx, c.gy, 6, COLORS.chipLight, 2.5, cell * 0.08, 400);
    this.trauma = Math.max(this.trauma, 0.14);
    if (this.combo === 4 || this.combo === 6 || this.combo === MAX_COMBO) {
      this.addPopup(
        c.gx,
        c.gy - 0.75,
        this.combo === MAX_COMBO ? "MAX COMBO!" : `COMBO ×${this.combo}`,
        COLORS.white,
        12,
      );
    }
    if (this.charge < PULSE_COST) {
      this.charge++;
      this.chargePop = 1;
      if (this.charge === PULSE_COST) {
        this.setChargeReady(true);
        this.audio.ready();
        this.addPopup(this.player.gx, this.player.gy - 0.9, "PULSE READY", COLORS.player, 13);
      }
    }
    this.spawnChip();
    this.levelCheck();
    this.checkBest();
    this.buzz(8);
  }

  private levelCheck(): void {
    const nl = 1 + Math.floor(this.chipsCollected / CHIPS_PER_LEVEL);
    if (nl <= this.level) return;
    this.level = nl;
    const unlocked = KIND_UNLOCK_LEVEL.indexOf(nl);
    const sub =
      unlocked >= 0 ? `${KINDS[unlocked].name}S ONLINE` : nl % 2 === 0 ? "THREAT ESCALATING" : "MACHINES ACCELERATE";
    const color = unlocked >= 0 ? KINDS[unlocked].color : COLORS.player;
    this.banner = { title: `LEVEL ${nl}`, sub, t: 0, life: 1700, color };
    const period = levelPeriod(this.effLevel);
    for (const e of this.enemies) e.period = period * KINDS[e.kind].speed;
    this.audio.levelUp();
    this.trauma = Math.max(this.trauma, 0.25);
    this.flash = { r: 34, g: 211, b: 238, a: 0.12 };
  }

  private hitPlayer(e: Enemy): void {
    const p = this.player;
    if (this.mode === "dead" || p.invuln > 0) return;
    const cell = this.layout.cell;
    this.killEnemy(e, false);
    if (this.mode === "attract") {
      this.trauma = Math.max(this.trauma, 0.25);
      return;
    }
    this.combo = 1;
    this.comboTimer = 0;
    this.lives--;
    this.livesPop = 1;
    this.flash = { r: 244, g: 63, b: 94, a: 0.45 };
    this.burst(p.gx, p.gy, 34, COLORS.player, 7, cell * 0.16, 700);
    this.burst(p.gx, p.gy, 14, COLORS.white, 4, cell * 0.1, 500);
    this.heldStack.length = 0;
    p.buffered = -1;
    if (this.lives <= 0) {
      this.mode = "dead";
      this.deathTimer = 1400;
      this.timeScale = 0.22;
      this.trauma = 1;
      this.hitstop = 120;
      this.burst(p.gx, p.gy, 70, COLORS.player, 9, cell * 0.2, 1400);
      this.burst(p.gx, p.gy, 30, COLORS.red, 6, cell * 0.14, 1200);
      this.rings.push({
        gx: p.gx,
        gy: p.gy,
        t: 0,
        life: 900,
        maxR: cell * 4,
        color: COLORS.player,
        width: cell * 0.25,
      });
      this.rings.push({ gx: p.gx, gy: p.gy, t: 0, life: 1200, maxR: cell * 5.5, color: COLORS.red, width: cell * 0.1 });
      this.audio.death();
      this.buzz([60, 40, 120]);
      return;
    }
    p.invuln = INVULN_MS;
    this.timeScale = 0.3;
    this.trauma = 0.7;
    this.hitstop = 70;
    this.buzz(50);
    this.rings.push({ gx: p.gx, gy: p.gy, t: 0, life: 500, maxR: cell * 1.8, color: COLORS.red, width: cell * 0.12 });
    this.addPopup(p.gx, p.gy - 0.8, "SHIELD LOST", COLORS.red, 15);
    this.audio.hit();
  }

  private killEnemy(e: Enemy, scoreIt: boolean): number {
    if (e.dead) return 0;
    e.dead = true;
    const K = KINDS[e.kind];
    const cell = this.layout.cell;
    this.burst(e.gx, e.gy, 24, K.color, 6, cell * 0.14, 620);
    this.burst(e.gx, e.gy, 8, K.light, 3, cell * 0.09, 450);
    this.rings.push({ gx: e.gx, gy: e.gy, t: 0, life: 320, maxR: cell * 0.95, color: K.color, width: 3 });
    if (!scoreIt) return 0;
    const pts = K.score;
    this.score += pts;
    this.kills++;
    this.addPopup(e.gx, e.gy, `+${pts}`, K.light, 14);
    this.audio.kill();
    return pts;
  }

  private pulse(): void {
    const p = this.player;
    if (this.charge < PULSE_COST) {
      this.chargeDeny = 1;
      this.audio.deny();
      return;
    }
    this.charge = 0;
    this.setChargeReady(false);
    const cell = this.layout.cell;
    const L = this.layout;
    this.rings.push({
      gx: p.gx,
      gy: p.gy,
      t: 0,
      life: 520,
      maxR: cell * (PULSE_RADIUS + 0.6),
      color: COLORS.player,
      width: cell * 0.22,
    });
    this.rings.push({
      gx: p.gx,
      gy: p.gy,
      t: 0,
      life: 680,
      maxR: cell * (PULSE_RADIUS + 1),
      color: COLORS.white,
      width: cell * 0.07,
    });
    this.particles.ring(
      L.ox + (p.gx + 0.5) * cell,
      L.oy + (p.gy + 0.5) * cell,
      COLORS.player,
      36,
      7 * (cell / 48),
      cell * 0.12,
      650,
    );

    let n = 0;
    for (const e of this.enemies) {
      if (!e.dead && chebyshev(e.gx, e.gy, p.gx, p.gy) <= PULSE_RADIUS) {
        this.killEnemy(e, true);
        n++;
      }
    }
    if (n > 0) this.enemies = this.enemies.filter((e) => !e.dead);
    for (let i = this.spawners.length - 1; i >= 0; i--) {
      const s = this.spawners[i];
      if (chebyshev(s.gx, s.gy, p.gx, p.gy) <= PULSE_RADIUS) {
        this.burst(s.gx, s.gy, 8, KINDS[s.kind].color, 3, cell * 0.08, 350);
        this.spawners.splice(i, 1);
      }
    }
    if (n >= 2) {
      const bonus = 100 * (n - 1);
      this.score += bonus;
      this.addPopup(p.gx, p.gy - 0.9, `PURGE ×${n}  +${bonus}`, COLORS.white, 16);
    }
    if (n > 0 && this.combo > 1) this.comboTimer = COMBO_WINDOW;
    this.hitstop = n > 0 ? 60 + 25 * n : 0;
    this.trauma = Math.max(this.trauma, n > 0 ? 0.6 + 0.08 * n : 0.35);
    this.pulseFlash = 1;
    this.flash = { r: 34, g: 211, b: 238, a: 0.18 };
    this.audio.pulse(n);
    this.buzz(n > 0 ? [30, 30, 60] : 25);
    this.checkBest();
  }

  // ------------------------------------------------------------ helpers

  private setChargeReady(v: boolean): void {
    if (v === this.chargeReady) return;
    this.chargeReady = v;
    this.callbacks.onChargeReady(v);
  }

  private addPopup(gx: number, gy: number, text: string, color: string, size: number): void {
    this.popups.push({ gx, gy, text, color, t: 0, life: 850, size });
    if (this.popups.length > 30) this.popups.shift();
  }

  private burst(gx: number, gy: number, count: number, color: string, speed: number, size: number, life: number): void {
    const L = this.layout;
    this.particles.emit(L.ox + (gx + 0.5) * L.cell, L.oy + (gy + 0.5) * L.cell, color, {
      count,
      speed: speed * (L.cell / 48),
      size,
      life,
    });
  }
}
