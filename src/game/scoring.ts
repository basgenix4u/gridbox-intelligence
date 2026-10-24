import { createLocalStorageStore } from "@/core/adapters/localStorageStore";
import type { KeyValueStore } from "@/core/ports/storage";

/**
 * Local leaderboard domain.
 *
 * Persistence is injected through the `KeyValueStore` port, so this module has
 * no DOM dependency and can be tested directly. Everything read back from
 * storage is parsed with Zod: localStorage is user-writable, so a hand-edited
 * or half-migrated entry must never be able to crash a run.
 */

/** Bumped whenever the scoring formula changes, so old runs can be labelled. */
export const CURRENT_SCORING_VERSION = 2;

export interface ScoreEntry {
  id: string;
  name: string;
  score: number;
  level: number;
  chips: number;
  maxCombo: number;
  date: number;
  /** Which scoring formula produced this run; absent on pre-versioning entries. */
  scoringVersion: number;
}

/**
 * Validation is hand-rolled rather than schema-library driven.
 *
 * Zod is used on the server, where bundle size is irrelevant. Shipping it to
 * the browser to validate a ten-row localStorage table cost ~88 kB (271 kB ->
 * 360 kB, 85 kB -> 110 kB gzipped) on a game whose whole appeal is that it
 * loads instantly. These few predicates buy the same safety for ~400 bytes.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isIntInRange(value: unknown, min: number, max: number = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Returns a normalised entry, or `null` if the candidate cannot be trusted. */
export function parseEntry(raw: unknown): ScoreEntry | null {
  if (!isRecord(raw)) return null;
  if (!isBoundedString(raw.id, 128)) return null;
  if (!isBoundedString(raw.name, 64)) return null;
  if (!isIntInRange(raw.score, 0)) return null;
  if (!isIntInRange(raw.level, 1)) return null;
  if (!isIntInRange(raw.chips, 0)) return null;
  if (!isIntInRange(raw.maxCombo, 1)) return null;
  if (!isIntInRange(raw.date, 0)) return null;

  const version = raw.scoringVersion;
  if (version !== undefined && !isIntInRange(version, 1)) return null;

  return {
    id: raw.id,
    name: raw.name,
    score: raw.score,
    level: raw.level,
    chips: raw.chips,
    maxCombo: raw.maxCombo,
    date: raw.date,
    scoringVersion: isIntInRange(version, 1) ? version : 1,
  };
}

export const MAX_SCORES = 10;

const KEY = "gridbox-intelligence.scores.v1";
const NAME_KEY = "gridbox-intelligence.name";

let defaultStore: KeyValueStore | null = null;

/** Lazily created so importing this module never touches `localStorage`. */
function defaultKV(): KeyValueStore {
  defaultStore ??= createLocalStorageStore();
  return defaultStore;
}

/** Test seam: swap the default store (e.g. for an in-memory one). */
export function setDefaultStore(store: KeyValueStore | null): void {
  defaultStore = store;
}

function readJson(store: KeyValueStore, key: string): unknown {
  const raw = store.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(store: KeyValueStore, key: string, value: unknown): void {
  try {
    store.set(key, JSON.stringify(value));
  } catch {
    /* serialisation failure — persistence is best-effort */
  }
}

/**
 * Parses and filters a stored list. Invalid entries are dropped rather than
 * throwing, because one corrupt row should not wipe a player's whole history.
 */
export function parseScores(raw: unknown): ScoreEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ScoreEntry[] = [];
  for (const candidate of raw) {
    const parsed = parseEntry(candidate);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push(parsed);
  }
  return sortScores(out).slice(0, MAX_SCORES);
}

export function sortScores(list: readonly ScoreEntry[]): ScoreEntry[] {
  return [...list].sort((a, b) => b.score - a.score || a.date - b.date);
}

/** True when the stored table predates `scoringVersion` and still needs tagging. */
function isLegacyTable(raw: unknown): boolean {
  return Array.isArray(raw) && raw.some((e) => isRecord(e) && e.scoringVersion === undefined);
}

/**
 * Reads the local table, upgrading a pre-versioning one on the way through.
 *
 * The upgrade is one-time and idempotent: entries written before versioning are
 * tagged `scoringVersion: 1` and the tagged table is written back, so a
 * returning player's history carries its version from then on and a second load
 * finds nothing to change. New entries are written with
 * `CURRENT_SCORING_VERSION` by the caller (see App.tsx).
 */
export function loadScores(store: KeyValueStore = defaultKV()): ScoreEntry[] {
  const raw = readJson(store, KEY);
  const parsed = parseScores(raw);
  if (isLegacyTable(raw)) {
    saveScores(migrateScores(parsed), store);
  }
  return parsed;
}

export function saveScores(list: readonly ScoreEntry[], store: KeyValueStore = defaultKV()): void {
  writeJson(store, KEY, sortScores(list).slice(0, MAX_SCORES));
}

/** Legacy entries predate `scoringVersion`; tag them so the UI can label them. */
export function migrateScores(list: readonly ScoreEntry[]): ScoreEntry[] {
  return list.map((e) => (e.scoringVersion ? e : { ...e, scoringVersion: 1 }));
}

export interface AddScoreResult {
  list: ScoreEntry[];
  /** 1-based rank, or -1 if the entry did not make the table. */
  rank: number;
}

export function addScore(entry: ScoreEntry, store: KeyValueStore = defaultKV()): AddScoreResult {
  const parsed = parseEntry(entry);
  if (!parsed) throw new Error("addScore: entry failed validation");
  const list = sortScores([...loadScores(store), parsed]).slice(0, MAX_SCORES);
  saveScores(list, store);
  const index = list.findIndex((e) => e.id === parsed.id);
  return { list, rank: index >= 0 ? index + 1 : -1 };
}

export function updateName(id: string, name: string, store: KeyValueStore = defaultKV()): ScoreEntry[] {
  const clean = sanitizeName(name) || "YOU";
  const list = loadScores(store).map((e) => (e.id === id ? { ...e, name: clean } : e));
  saveScores(list, store);
  return list;
}

export function clearScores(store: KeyValueStore = defaultKV()): ScoreEntry[] {
  saveScores([], store);
  return [];
}

export function loadName(store: KeyValueStore = defaultKV()): string {
  const n = store.get(NAME_KEY);
  return n?.length ? n.slice(0, 3).toUpperCase() : "YOU";
}

export function saveName(name: string, store: KeyValueStore = defaultKV()): void {
  store.set(NAME_KEY, sanitizeName(name).slice(0, 3));
}

/** Allowlist: uppercase alphanumerics only, capped at three characters. */
export function sanitizeName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);
}
