// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../core/adapters/memoryStore.js";
import { installDomStubs } from "../test/domStubs.js";
import {
  collectLegacyScores,
  hasMigratedLocally,
  migrateLocalScores,
  setMigrationStore,
  toLegacyScore,
} from "./migrateLocalScores.js";
import { saveScores, type ScoreEntry } from "../game/scoring.js";

installDomStubs();

const KEY = "gridbox-intelligence.scores.v1";
const FLAG = "gridbox-intelligence.scores.migrated.v1";

function entry(overrides: Partial<ScoreEntry> = {}): ScoreEntry {
  return {
    id: "local-1",
    name: "ABC",
    score: 5_000,
    level: 8,
    chips: 60,
    maxCombo: 8,
    date: 1_700_000_000_000,
    scoringVersion: 1,
    ...overrides,
  };
}

/** A store pre-loaded with a returning player's local history. */
function returningPlayerStore(
  entries: ScoreEntry[] = [entry({ id: "a", score: 5_000 }), entry({ id: "b", score: 9_000 })],
) {
  const store = createMemoryStore();
  saveScores(entries, store);
  return store;
}

/** A fetch double shaped like the real one, so it satisfies `typeof fetch`. */
function okFetch(body: unknown = { migrated: 2, duplicates: 0 }) {
  const impl = (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response);
  return vi.fn(impl);
}

beforeEach(() => {
  setMigrationStore(null);
});

describe("collectLegacyScores", () => {
  it("maps the local table onto the wire shape", () => {
    const store = returningPlayerStore([entry({ id: "a", score: 5_000 })]);
    expect(collectLegacyScores(store)).toEqual([
      { id: "a", score: 5_000, level: 8, chips: 60, maxCombo: 8, date: 1_700_000_000_000, scoringVersion: 1 },
    ]);
  });

  it("returns nothing for an empty or corrupt table", () => {
    expect(collectLegacyScores(createMemoryStore())).toEqual([]);
    expect(collectLegacyScores(createMemoryStore({ [KEY]: "{not json" }))).toEqual([]);
  });
});

describe("toLegacyScore", () => {
  it("carries the scoring version through, defaulting a missing one to 1", () => {
    const { scoringVersion: _omitted, ...legacy } = entry();
    expect(toLegacyScore(legacy as ScoreEntry).scoringVersion).toBe(1);
    expect(toLegacyScore(entry({ scoringVersion: 2 })).scoringVersion).toBe(2);
  });
});

describe("migrateLocalScores", () => {
  it("uploads the history once and records the attempt", async () => {
    const store = returningPlayerStore();
    const fetchImpl = okFetch({ migrated: 2, duplicates: 0 });
    const outcome = await migrateLocalScores({ token: "jwt", store, fetchImpl });

    expect(outcome).toEqual({ status: "migrated", migrated: 2, duplicates: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/me/migrate-scores");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer jwt");
    const sent = JSON.parse(init.body as string) as { entries: { id: string }[] };
    expect(sent.entries.map((e) => e.id)).toEqual(["b", "a"]); // best first
    expect(store.get(FLAG)).toBe("1");
  });

  it("does nothing on a second call — the one-shot flag", async () => {
    const store = returningPlayerStore();
    const fetchImpl = okFetch();
    await migrateLocalScores({ token: "jwt", store, fetchImpl });
    const again = await migrateLocalScores({ token: "jwt", store, fetchImpl });
    expect(again).toEqual({ status: "already-migrated" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("leaves the flag unset when the server rejects the batch, so it retries", async () => {
    const store = returningPlayerStore();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as unknown as Response),
    ) as unknown as typeof fetch;
    const outcome = await migrateLocalScores({ token: "jwt", store, fetchImpl });
    expect(outcome).toEqual({ status: "failed", reason: "server responded 500" });
    expect(store.get(FLAG)).toBeNull();
    expect(hasMigratedLocally(store)).toBe(false);
  });

  it("reports a network failure without throwing", async () => {
    const store = returningPlayerStore();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      Promise.reject(new Error("offline")),
    ) as unknown as typeof fetch;
    await expect(migrateLocalScores({ token: "jwt", store, fetchImpl })).resolves.toEqual({
      status: "failed",
      reason: "offline",
    });
    expect(store.get(FLAG)).toBeNull();
  });

  it("skips a player with no session, without marking the flag", async () => {
    const store = returningPlayerStore();
    const fetchImpl = okFetch();
    expect(await migrateLocalScores({ token: null, store, fetchImpl })).toEqual({
      status: "skipped",
      reason: "no-session",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.get(FLAG)).toBeNull();
  });

  it("marks the flag when there is nothing to upload", async () => {
    const store = createMemoryStore();
    const fetchImpl = okFetch();
    expect(await migrateLocalScores({ token: "jwt", store, fetchImpl })).toEqual({
      status: "skipped",
      reason: "no-scores",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.get(FLAG)).toBe("1");
  });

  it("survives a corrupt local table", async () => {
    const store = createMemoryStore({ [KEY]: '[{"id":123}]' });
    const fetchImpl = okFetch();
    expect(await migrateLocalScores({ token: "jwt", store, fetchImpl })).toEqual({
      status: "skipped",
      reason: "no-scores",
    });
  });
});
