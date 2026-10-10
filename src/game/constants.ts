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
  bg: "#0e010f",
  player: "#e7829b",
  playerLight: "#f8e3ec",
  chip: "#da4167",
  chipLight: "#f6c9d9",
  red: "#f43f5e",
  white: "#ffffff",
  slate: "#9d7f96",
};

/**
 * Player-sprite accent presets.
 *
 * Self-expression is the one motive that consistently separates players who
 * return (Customisation/Design motive — Quantic Foundry 2016; VMQ 2026), and it
 * is cheap to offer. Presets are curated rather than a free colour picker so
 * every option stays legible against the board; `jade`/`frost` double as
 * colour-vision-safe alternatives to the pink-family defaults.
 */
export interface AccentDef {
  id: string;
  label: string;
  player: string;
  playerLight: string;
}

export const ACCENTS: readonly AccentDef[] = [
  { id: "bloom", label: "Bloom", player: "#e7829b", playerLight: "#f8e3ec" },
  { id: "orchid", label: "Orchid", player: "#c084fc", playerLight: "#e9d5ff" },
  { id: "ember", label: "Ember", player: "#fbbf24", playerLight: "#fef3c7" },
  { id: "jade", label: "Jade", player: "#4ade80", playerLight: "#dcfce7" },
  { id: "frost", label: "Frost", player: "#7dd3fc", playerLight: "#e0f2fe" },
] as const;

/** Applies an accent preset to the live palette (player sprite only). */
export function applyAccent(id: string): void {
  const accent = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
  COLORS.player = accent.player;
  COLORS.playerLight = accent.playerLight;
}

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
