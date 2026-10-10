import { createLocalStorageStore } from "@/core/adapters/localStorageStore";
import type { KeyValueStore } from "@/core/ports/storage";
import type { RunStats } from "@/game/types";

/**
 * Persistent player profile — the meta-progression layer.
 *
 * This is what turns a 60-second arcade loop into a habit: totals, bests,
 * play-streaks and unlocked achievements survive the browser session and give
 * every run a reason to happen. Motivation basis and the ethics constraints are
 * documented in `docs/PSYCHOLOGY-DESIGN.md`.
 *
 * Persistence is injected through the `KeyValueStore` port and validated with
 * hand-rolled predicates (see `scoring.ts` for why no schema library ships to
 * the client).
 */

export interface Streak {
  /** Consecutive local days with at least one run. */
  current: number;
  longest: number;
  /** Local-day stamp `YYYY-MM-DD` of the last day a run was played. */
  lastDay: string;
}

export interface Profile {
  version: 1;
  createdAt: number;
  runsPlayed: number;
  totalChips: number;
  totalKills: number;
  totalPlayMs: number;
  bestScore: number;
  bestLevel: number;
  maxCombo: number;
  bestPulseKills: number;
  streak: Streak;
  /** Achievement ids already claimed. */
  unlocked: string[];
  /** Player-sprite accent preset id. */
  accent: string;
}

export const PROFILE_KEY = "gridbox-intelligence.profile.v1";
export const DEFAULT_ACCENT = "bloom";

export function defaultProfile(now: number = Date.now()): Profile {
  return {
    version: 1,
    createdAt: now,
    runsPlayed: 0,
    totalChips: 0,
    totalKills: 0,
    totalPlayMs: 0,
    bestScore: 0,
    bestLevel: 1,
    maxCombo: 1,
    bestPulseKills: 0,
    streak: { current: 0, longest: 0, lastDay: "" },
    unlocked: [],
    accent: DEFAULT_ACCENT,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntInRange(value: unknown, min: number, max: number = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

/** `YYYY-MM-DD` in the player's local timezone. */
export function dayStamp(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function previousDayStamp(ms: number): string {
  return dayStamp(ms - 24 * 60 * 60 * 1000);
}

/**
 * Streak update on the day a run was played.
 *
 * Same day → unchanged. Previous day → +1. Any gap → reset to 1. Missing a day
 * only resets a counter: nothing is ever blocked and nothing is ever taken away
 * (see the ethics section of the design doc).
 */
export function applyStreak(streak: Streak, nowMs: number): Streak {
  const day = dayStamp(nowMs);
  if (streak.lastDay === day) return streak;
  const current = streak.lastDay === previousDayStamp(nowMs) ? streak.current + 1 : 1;
  return { current, longest: Math.max(current, streak.longest), lastDay: day };
}

/**
 * Fold a finished run into the profile. Pure: returns a new profile, and
 * `newBest` so the UI can celebrate without re-deriving the comparison.
 */
export function recordRun(profile: Profile, stats: RunStats, nowMs: number): { profile: Profile; newBest: boolean } {
  const newBest = stats.score > profile.bestScore;
  return {
    newBest,
    profile: {
      ...profile,
      runsPlayed: profile.runsPlayed + 1,
      totalChips: profile.totalChips + stats.chips,
      totalKills: profile.totalKills + stats.kills,
      totalPlayMs: profile.totalPlayMs + stats.timeMs,
      bestScore: Math.max(profile.bestScore, stats.score),
      bestLevel: Math.max(profile.bestLevel, stats.level),
      maxCombo: Math.max(profile.maxCombo, stats.maxCombo),
      bestPulseKills: Math.max(profile.bestPulseKills, stats.bestPulseKills),
      streak: applyStreak(profile.streak, nowMs),
    },
  };
}

/** Returns a normalised profile, or `null` if the candidate cannot be trusted. */
export function parseProfile(raw: unknown): Profile | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== 1) return null;
  if (!isIntInRange(raw.createdAt, 0)) return null;
  if (!isIntInRange(raw.runsPlayed, 0)) return null;
  if (!isIntInRange(raw.totalChips, 0)) return null;
  if (!isIntInRange(raw.totalKills, 0)) return null;
  if (!isIntInRange(raw.totalPlayMs, 0)) return null;
  if (!isIntInRange(raw.bestScore, 0)) return null;
  if (!isIntInRange(raw.bestLevel, 1)) return null;
  if (!isIntInRange(raw.maxCombo, 1)) return null;
  if (!isIntInRange(raw.bestPulseKills, 0)) return null;
  if (!isBoundedString(raw.accent, 32) || raw.accent.trim().length === 0) return null;

  const s = raw.streak;
  if (!isRecord(s)) return null;
  if (!isIntInRange(s.current, 0)) return null;
  if (!isIntInRange(s.longest, 0)) return null;
  if (!isBoundedString(s.lastDay, 32)) return null;

  const u = raw.unlocked;
  if (!Array.isArray(u) || u.length > 256) return null;
  const unlocked: string[] = [];
  for (const id of u) {
    if (!isBoundedString(id, 64)) return null;
    if (!unlocked.includes(id)) unlocked.push(id);
  }

  return {
    version: 1,
    createdAt: raw.createdAt,
    runsPlayed: raw.runsPlayed,
    totalChips: raw.totalChips,
    totalKills: raw.totalKills,
    totalPlayMs: raw.totalPlayMs,
    bestScore: raw.bestScore,
    bestLevel: raw.bestLevel,
    maxCombo: raw.maxCombo,
    bestPulseKills: raw.bestPulseKills,
    streak: { current: s.current, longest: s.longest, lastDay: s.lastDay },
    unlocked,
    accent: raw.accent,
  };
}

let defaultStore: KeyValueStore | null = null;
function store(s?: KeyValueStore): KeyValueStore {
  if (s) return s;
  if (!defaultStore) defaultStore = createLocalStorageStore();
  return defaultStore;
}

export function loadProfile(s?: KeyValueStore, now: number = Date.now()): Profile {
  const raw = store(s).get(PROFILE_KEY);
  if (raw === null) return defaultProfile(now);
  try {
    return parseProfile(JSON.parse(raw)) ?? defaultProfile(now);
  } catch {
    return defaultProfile(now);
  }
}

export function saveProfile(profile: Profile, s?: KeyValueStore): void {
  store(s).set(PROFILE_KEY, JSON.stringify(profile));
}
