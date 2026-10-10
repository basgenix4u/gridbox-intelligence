import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@/core/adapters/memoryStore";
import type { RunStats } from "@/game/types";
import {
  applyStreak,
  dayStamp,
  defaultProfile,
  loadProfile,
  parseProfile,
  PROFILE_KEY,
  recordRun,
  saveProfile,
} from "./profile";

function stats(overrides: Partial<RunStats> = {}): RunStats {
  return {
    score: 1_200,
    level: 5,
    chips: 12,
    maxCombo: 3,
    kills: 7,
    timeMs: 30_000,
    bestPulseKills: 2,
    ...overrides,
  };
}

describe("dayStamp", () => {
  it("formats a local day stamp", () => {
    const d = new Date(2026, 9, 9, 13, 45); // 2026-10-09 local
    expect(dayStamp(d.getTime())).toBe("2026-10-09");
  });
});

describe("applyStreak", () => {
  it("keeps the streak on the same day", () => {
    const now = new Date(2026, 9, 9, 9).getTime();
    const s = { current: 3, longest: 5, lastDay: dayStamp(now) };
    expect(applyStreak(s, now + 3 * 60 * 60 * 1000)).toEqual(s);
  });

  it("increments on the next day", () => {
    const day1 = new Date(2026, 9, 8, 22).getTime();
    const day2 = new Date(2026, 9, 9, 8).getTime();
    const s = applyStreak({ current: 3, longest: 5, lastDay: dayStamp(day1) }, day2);
    expect(s.current).toBe(4);
    expect(s.longest).toBe(5);
  });

  it("resets after a gap and tracks a new longest", () => {
    const day1 = new Date(2026, 9, 5, 22).getTime();
    const day5 = new Date(2026, 9, 9, 8).getTime();
    const s = applyStreak({ current: 9, longest: 9, lastDay: dayStamp(day1) }, day5);
    expect(s.current).toBe(1);
    expect(s.longest).toBe(9);
  });

  it("is timezone-safe across a month boundary", () => {
    const day31 = new Date(2026, 10, 30, 23).getTime();
    const day32 = new Date(2026, 11, 1, 0).getTime(); // next month's 1st? careful: month 10=Nov 30
    const s = applyStreak({ current: 2, longest: 2, lastDay: dayStamp(day31) }, day32);
    expect(s.current).toBe(3);
  });
});

describe("recordRun", () => {
  it("folds totals and bests into a new profile", () => {
    const base = defaultProfile(0);
    const { profile, newBest } = recordRun(base, stats(), 1_000);
    expect(newBest).toBe(true);
    expect(profile.runsPlayed).toBe(1);
    expect(profile.totalChips).toBe(12);
    expect(profile.totalKills).toBe(7);
    expect(profile.totalPlayMs).toBe(30_000);
    expect(profile.bestScore).toBe(1_200);
    expect(profile.bestLevel).toBe(5);
    expect(profile.maxCombo).toBe(3);
    expect(profile.bestPulseKills).toBe(2);
    expect(base.runsPlayed).toBe(0); // pure: input untouched
  });

  it("only reports newBest above the stored best", () => {
    const base = { ...defaultProfile(0), bestScore: 5_000 };
    const { newBest, profile } = recordRun(base, stats({ score: 4_000 }), 1_000);
    expect(newBest).toBe(false);
    expect(profile.bestScore).toBe(5_000);
  });
});

describe("loadProfile / saveProfile", () => {
  it("returns a fresh profile when storage is empty", () => {
    const p = loadProfile(createMemoryStore(), 42);
    expect(p.createdAt).toBe(42);
    expect(p.runsPlayed).toBe(0);
  });

  it("round-trips through the store", () => {
    const store = createMemoryStore();
    const p = recordRun(defaultProfile(0), stats(), 1_000).profile;
    saveProfile(p, store);
    expect(loadProfile(store, 999)).toEqual(p);
  });

  it("falls back to defaults on corrupt JSON", () => {
    const store = createMemoryStore();
    store.set(PROFILE_KEY, "{not json");
    expect(loadProfile(store, 7).createdAt).toBe(7);
  });

  it("falls back to defaults on an untrusted shape", () => {
    const store = createMemoryStore();
    store.set(PROFILE_KEY, JSON.stringify({ version: 1, runsPlayed: -3 }));
    expect(loadProfile(store, 7).runsPlayed).toBe(0);
  });
});

describe("parseProfile", () => {
  const valid = defaultProfile(0);

  it("accepts a well-formed profile", () => {
    expect(parseProfile(valid)).toEqual(valid);
  });

  it("rejects unknown versions", () => {
    expect(parseProfile({ ...valid, version: 2 })).toBeNull();
  });

  it("rejects non-integer counters", () => {
    expect(parseProfile({ ...valid, totalChips: 1.5 })).toBeNull();
    expect(parseProfile({ ...valid, totalChips: "12" })).toBeNull();
  });

  it("rejects a hostile unlocked list", () => {
    expect(parseProfile({ ...valid, unlocked: [{ evil: true }] })).toBeNull();
    expect(parseProfile({ ...valid, unlocked: Array(300).fill("x") })).toBeNull();
  });

  it("deduplicates unlocked ids", () => {
    const p = parseProfile({ ...valid, unlocked: ["a", "b", "a"] });
    expect(p?.unlocked).toEqual(["a", "b"]);
  });

  it("rejects a missing streak", () => {
    expect(parseProfile({ ...valid, streak: "hot" })).toBeNull();
  });
});
