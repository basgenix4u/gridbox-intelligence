export const COLS = 9;
export const ROWS = 9;

export const PULSE_COST = 5; // chips needed to charge a pulse
export const PULSE_RADIUS = 2; // chebyshev radius (5x5 area)
export const CHIPS_ON_BOARD = 3;
export const CHIPS_PER_LEVEL = 7;
export const COMBO_WINDOW = 2200; // ms to keep the combo alive
export const MAX_COMBO = 8;
export const START_LIVES = 3;

export const MOVE_COOLDOWN = 70; // ms between player steps
export const HOLD_FIRST = 170; // ms before key-hold auto repeat starts
export const HOLD_REPEAT = 115; // ms between auto-repeated steps
export const INVULN_MS = 1500;
export const SPAWN_TELEGRAPH = 850;
export const PRED_WINDOW = 450; // oracle predicts movement for this long after a step

export const COLORS = {
  bg: "#070a12",
  player: "#22d3ee",
  playerLight: "#cffafe",
  chip: "#fbbf24",
  chipLight: "#fef3c7",
  red: "#f43f5e",
  white: "#ffffff",
  slate: "#94a3b8",
};

export interface KindDef {
  name: string;
  color: string;
  light: string;
  speed: number; // multiplier on tick period (higher = slower)
  score: number;
  desc: string;
}

export const KINDS: KindDef[] = [
  {
    name: "DRONE",
    color: "#4ade80",
    light: "#dcfce7",
    speed: 1.35,
    score: 50,
    desc: "Wanders with a vague interest in you.",
  },
  {
    name: "HUNTER",
    color: "#fb923c",
    light: "#ffedd5",
    speed: 1.0,
    score: 75,
    desc: "Chases in straight lines. Walls confuse it.",
  },
  {
    name: "MIND",
    color: "#a78bfa",
    light: "#ede9fe",
    speed: 1.0,
    score: 100,
    desc: "Pathfinds around every wall.",
  },
  {
    name: "ORACLE",
    color: "#f43f5e",
    light: "#ffe4e6",
    speed: 0.82,
    score: 150,
    desc: "Predicts where you will move next.",
  },
];

export const KIND_UNLOCK_LEVEL = [1, 2, 3, 5];

export function levelPeriod(level: number): number {
  return Math.max(260, 640 - (level - 1) * 42);
}

export function levelMaxEnemies(level: number): number {
  return Math.min(8, 1 + level);
}

export function levelSpawnEvery(level: number): number {
  return Math.max(1000, 2800 - (level - 1) * 220);
}

export function kindWeights(level: number): number[] {
  if (level <= 1) return [1, 0, 0, 0];
  if (level === 2) return [0.5, 0.5, 0, 0];
  if (level === 3) return [0.3, 0.4, 0.3, 0];
  if (level === 4) return [0.2, 0.35, 0.45, 0];
  if (level <= 7) return [0.1, 0.25, 0.4, 0.25];
  return [0.05, 0.15, 0.4, 0.4];
}
