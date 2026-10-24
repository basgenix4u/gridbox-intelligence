import { loadScores, type ScoreEntry } from "../game/scoring.js";
import { createLocalStorageStore } from "../core/adapters/localStorageStore.js";
import type { KeyValueStore } from "../core/ports/storage.js";
import type { LegacyScore } from "../shared/contracts.js";

/**
 * Client half of the legacy-score migration (task 3.13).
 *
 * A returning player's browser holds scores produced before this server
 * existed. After the upgrade, the first time they set a username and play, that
 * history is uploaded once so their record reflects in the system instead of
 * living in one browser forever.
 *
 * The rules that make it safe on the client:
 *
 * - **One-shot**: a local flag records the attempt, so a page reload never
 *   re-uploads. The flag is only set once the server has *accepted* the batch —
 *   a failed attempt stays retryable.
 * - **Idempotent**: the browser's own entry ids travel with the batch, so even
 *   if the flag is lost the server dedupes and the totals cannot double-count.
 * - **Never fatal**: every outcome is a value, never a throw. A migration
 *   failure must not stop anyone playing.
 *
 * Zod is deliberately not imported here — see the note in `game/scoring.ts`
 * about the bundle. Only types come from the shared contract.
 */

const MIGRATION_FLAG_KEY = "gridbox-intelligence.scores.migrated.v1";

export type MigrationOutcome =
  | { status: "already-migrated" }
  | { status: "skipped"; reason: "no-scores" | "no-session" }
  | { status: "migrated"; migrated: number; duplicates: number }
  | { status: "failed"; reason: string };

export interface MigrationDeps {
  /** The player's session token; without one there is nothing to migrate into. */
  token: string | null;
  store?: KeyValueStore;
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** API origin; relative in the browser, absolute in tests. */
  baseUrl?: string;
}

/** True once this browser has completed (or deliberately skipped) a migration. */
export function hasMigratedLocally(store: KeyValueStore): boolean {
  return store.get(MIGRATION_FLAG_KEY) === "1";
}

/**
 * Maps a local entry onto the wire shape, tagging a missing version as 1.
 * `loadScores` already tags everything it returns, so this is belt-and-braces
 * for an entry built by hand (or by an older build) that never went through it.
 */
export function toLegacyScore(entry: ScoreEntry): LegacyScore {
  return {
    id: entry.id,
    score: entry.score,
    level: entry.level,
    chips: entry.chips,
    maxCombo: entry.maxCombo,
    date: entry.date,
    scoringVersion: entry.scoringVersion ?? 1,
  };
}

/** Reads the local table, ready for upload. Empty when there is nothing to send. */
export function collectLegacyScores(store: KeyValueStore): LegacyScore[] {
  return loadScores(store).map(toLegacyScore);
}

/**
 * Uploads the local history once. Safe to call on every page load: the flag,
 * the server-side dedupe and the empty-batch check all make a repeat a no-op.
 */
export async function migrateLocalScores(deps: MigrationDeps): Promise<MigrationOutcome> {
  const store = deps.store ?? resolveStore();
  if (hasMigratedLocally(store)) return { status: "already-migrated" };
  if (!deps.token) return { status: "skipped", reason: "no-session" };

  const entries = collectLegacyScores(store);
  if (entries.length === 0) {
    // Nothing to migrate — record the attempt so this never runs again.
    store.set(MIGRATION_FLAG_KEY, "1");
    return { status: "skipped", reason: "no-scores" };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? "";
  try {
    const res = await fetchImpl(`${base}/v1/me/migrate-scores`, {
      method: "POST",
      headers: { authorization: `Bearer ${deps.token}`, "content-type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) {
      // Leave the flag unset: the next play retries, and the server dedupes.
      return { status: "failed", reason: `server responded ${res.status}` };
    }
    store.set(MIGRATION_FLAG_KEY, "1");
    const body = (await res.json()) as { migrated: number; duplicates: number };
    return { status: "migrated", migrated: body.migrated, duplicates: body.duplicates };
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : "network error" };
  }
}

/**
 * Lazily created, exactly as `game/scoring.ts` does it, so importing this
 * module never touches localStorage.
 */
let defaultStore: KeyValueStore | null = null;
function resolveStore(): KeyValueStore {
  defaultStore ??= createLocalStorageStore();
  return defaultStore;
}

/** Test seam: swap the default store. */
export function setMigrationStore(store: KeyValueStore | null): void {
  defaultStore = store;
}
