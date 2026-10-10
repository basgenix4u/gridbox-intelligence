import type { Profile } from "./profile";

/**
 * Achievement catalogue and progress maths.
 *
 * Design notes (see `docs/PSYCHOLOGY-DESIGN.md`):
 *
 * - **Goal-gradient** — `nearest()` ranks unfinished achievements by proximity,
 *   because effort accelerates when a *visible* goal is close (Kivetz 2006).
 * - **Endowed progress** — multi-step achievements declare an `endowed` value
 *   that displays as already-credited progress. The car-wash field experiment
 *   (Nunes & Dreze 2006) found 34 % vs 19 % completion from this alone. The
 *   required effort is unchanged; only the starting marker moves.
 * - Targets are tuned as collection arcs, not one-shot wins: several run
 *   alongside each other so *something* is always within reach.
 */

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Single-glyph icon — text, so it inherits theme colours and a11y. */
  glyph: string;
  /** Value at which the achievement unlocks. */
  target: number;
  /** Head-start value shown before any play (endowed progress). Only
   *  *collection* arcs carry credit — skill peaks show measured progress so the
   *  display never claims a feat that did not happen. */
  endowed: number;
  measure: (p: Profile) => number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: "first-harvest",
    name: "First Harvest",
    desc: "Collect your first data chip.",
    glyph: "◆",
    target: 1,
    endowed: 0,
    measure: (p) => p.totalChips,
  },
  {
    id: "chip-100",
    name: "Data Miner",
    desc: "Collect 100 data chips in total. 25 are banked to get you moving.",
    glyph: "◈",
    target: 100,
    endowed: 25,
    measure: (p) => p.totalChips,
  },
  {
    id: "chip-500",
    name: "Deep Core",
    desc: "Collect 500 data chips in total. 100 are banked.",
    glyph: "✦",
    target: 500,
    endowed: 100,
    measure: (p) => p.totalChips,
  },
  {
    id: "combo-8",
    name: "Perfect Chain",
    desc: "Reach a ×8 combo multiplier.",
    glyph: "⚡",
    target: 8,
    endowed: 0,
    measure: (p) => p.maxCombo,
  },
  {
    id: "pulse-5",
    name: "Clean Sweep",
    desc: "Purge 5 machines with a single pulse.",
    glyph: "◎",
    target: 5,
    endowed: 0,
    measure: (p) => p.bestPulseKills,
  },
  {
    id: "level-10",
    name: "Breakthrough",
    desc: "Reach level 10 in a single run.",
    glyph: "▲",
    target: 10,
    endowed: 0,
    measure: (p) => p.bestLevel,
  },
  {
    id: "level-20",
    name: "Overclocked",
    desc: "Reach level 20 in a single run.",
    glyph: "△",
    target: 20,
    endowed: 0,
    measure: (p) => p.bestLevel,
  },
  {
    id: "runs-10",
    name: "Regular",
    desc: "Play 10 runs. 2 are banked.",
    glyph: "▶",
    target: 10,
    endowed: 2,
    measure: (p) => p.runsPlayed,
  },
  {
    id: "runs-50",
    name: "Dedicated Signal",
    desc: "Play 50 runs. 10 are banked.",
    glyph: "»",
    target: 50,
    endowed: 10,
    measure: (p) => p.runsPlayed,
  },
  {
    id: "streak-3",
    name: "On A Roll",
    desc: "Play 3 days in a row. Day one counts.",
    glyph: "◆",
    target: 3,
    endowed: 1,
    measure: (p) => p.streak.longest,
  },
  {
    id: "streak-7",
    name: "Unbroken Line",
    desc: "Play 7 days in a row. Day one counts.",
    glyph: "★",
    target: 7,
    endowed: 1,
    measure: (p) => p.streak.longest,
  },
  {
    id: "kills-250",
    name: "System Purge",
    desc: "Purge 250 machines in total. 50 are banked.",
    glyph: "✕",
    target: 250,
    endowed: 50,
    measure: (p) => p.totalKills,
  },
] as const;

export interface AchievementProgress {
  def: AchievementDef;
  /** Displayed value: measured progress, never below the endowed head start. */
  current: number;
  target: number;
  /** 0..1 */
  pct: number;
  remaining: number;
  unlocked: boolean;
}

export function progressOf(def: AchievementDef, profile: Profile, unlocked: ReadonlySet<string>): AchievementProgress {
  const measured = def.measure(profile);
  const current = Math.min(def.target, Math.max(def.endowed, measured));
  return {
    def,
    current,
    target: def.target,
    pct: current / def.target,
    remaining: def.target - current,
    unlocked: unlocked.has(def.id) || current >= def.target,
  };
}

export function allProgress(profile: Profile): AchievementProgress[] {
  const unlocked = new Set(profile.unlocked);
  return ACHIEVEMENTS.map((def) => progressOf(def, profile, unlocked));
}

/**
 * Ids whose goal is met but which are not yet claimed. The caller stores the
 * claim and celebrates — the UI layer decides how loud to be.
 */
export function newlyUnlocked(profile: Profile): string[] {
  return allProgress(profile)
    .filter((pr) => pr.current >= pr.target && !profile.unlocked.includes(pr.def.id))
    .map((pr) => pr.def.id);
}

/** Ids already claimed. */
export function markUnlocked(profile: Profile, ids: readonly string[]): Profile {
  const merged = [...profile.unlocked];
  for (const id of ids) if (!merged.includes(id)) merged.push(id);
  return { ...profile, unlocked: merged };
}

/**
 * The `n` closest-to-done achievements, nearest first.
 *
 * Goal-gradient ordering: showing what is almost finished (not what is barely
 * started) is what accelerates effort. Unfinished only — completed rows would
 * dilute the "almost there" signal.
 */
export function nearest(profile: Profile, n: number): AchievementProgress[] {
  return allProgress(profile)
    .filter((pr) => !pr.unlocked && pr.current > 0)
    .sort((a, b) => b.pct - a.pct || a.remaining - b.remaining)
    .slice(0, n);
}

/** True when `id` is claimed in this profile. */
export function isUnlocked(profile: Profile, id: string): boolean {
  return profile.unlocked.includes(id);
}
