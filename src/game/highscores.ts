export interface ScoreEntry {
  id: string;
  name: string;
  score: number;
  level: number;
  chips: number;
  maxCombo: number;
  date: number;
}

export const MAX_SCORES = 10;
const KEY = "gridbox-intelligence.scores.v1";
const NAME_KEY = "gridbox-intelligence.name";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode etc.) — ignore */
  }
}

export function loadScores(): ScoreEntry[] {
  const raw = safeGet(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is ScoreEntry => !!e && typeof e === "object" && typeof (e as ScoreEntry).score === "number")
      .slice(0, MAX_SCORES);
  } catch {
    return [];
  }
}

export function saveScores(list: ScoreEntry[]): void {
  safeSet(KEY, JSON.stringify(list.slice(0, MAX_SCORES)));
}

/** Inserts an entry; returns the new list and the 1-based rank (or -1 if it didn't make the table). */
export function addScore(entry: ScoreEntry): { list: ScoreEntry[]; rank: number } {
  const list = [...loadScores(), entry].sort((a, b) => b.score - a.score || a.date - b.date).slice(0, MAX_SCORES);
  saveScores(list);
  const rank = list.findIndex((e) => e.id === entry.id);
  return { list, rank: rank >= 0 ? rank + 1 : -1 };
}

export function updateName(id: string, name: string): ScoreEntry[] {
  const list = loadScores().map((e) => (e.id === id ? { ...e, name } : e));
  saveScores(list);
  return list;
}

export function clearScores(): ScoreEntry[] {
  saveScores([]);
  return [];
}

export function loadName(): string {
  const n = safeGet(NAME_KEY);
  return n && n.length ? n.slice(0, 3).toUpperCase() : "YOU";
}

export function saveName(name: string): void {
  safeSet(NAME_KEY, name.slice(0, 3).toUpperCase());
}

export function sanitizeName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);
}
