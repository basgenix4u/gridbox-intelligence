export type Dir = 0 | 1 | 2 | 3; // up, right, down, left
export const DIRS: readonly Dir[] = [0, 1, 2, 3];
export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];

export interface Player {
  gx: number;
  gy: number;
  vx: number;
  vy: number;
  facing: Dir;
  cooldown: number;
  buffered: Dir | -1;
  invuln: number;
  sx: number;
  sy: number;
  bumpX: number;
  bumpY: number;
  lastMoveAt: number;
}

export interface Enemy {
  id: number;
  kind: number;
  gx: number;
  gy: number;
  vx: number;
  vy: number;
  timer: number;
  period: number;
  intent: Dir | -1;
  spawnAnim: number;
  sx: number;
  sy: number;
  dead: boolean;
  seed: number;
}

export interface Chip {
  gx: number;
  gy: number;
  phase: number;
  anim: number;
}

export interface Spawner {
  gx: number;
  gy: number;
  kind: number;
  t: number;
  total: number;
}

export interface Popup {
  gx: number;
  gy: number;
  text: string;
  color: string;
  t: number;
  life: number;
  size: number;
}

export interface Ring {
  gx: number;
  gy: number;
  t: number;
  life: number;
  maxR: number;
  color: string;
  width: number;
}

export interface Ghost {
  x: number;
  y: number;
  t: number;
}

export interface Banner {
  title: string;
  sub: string;
  t: number;
  life: number;
  color: string;
}

export interface RunStats {
  score: number;
  level: number;
  chips: number;
  maxCombo: number;
  kills: number;
  timeMs: number;
}

export type GameMode = "attract" | "playing" | "dead";

export interface Layout {
  W: number;
  H: number;
  cell: number;
  ox: number;
  oy: number;
  hudH: number;
  botH: number;
  pad: number;
  dpr: number;
}
