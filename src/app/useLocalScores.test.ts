// @vitest-environment jsdom

/**
 * useLocalScores (task 4.1).
 *
 * The local table is the source of truth for the game itself: a server outage
 * must never erase a score the player actually earned. These tests pin the
 * behaviours that guarantee it — recording, renaming in place, clearing, and
 * the rank the game-over screen shows.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ScoreEntry } from "../game/scoring.js";
import { useLocalScores } from "./useLocalScores.js";

const KEY = "gridbox-intelligence.scores.v1";

function entry(overrides: Partial<ScoreEntry> = {}): ScoreEntry {
  return {
    id: "run-1",
    name: "YOU",
    score: 1000,
    level: 1,
    chips: 7,
    maxCombo: 2,
    date: 1_700_000_000_000,
    scoringVersion: 1,
    ...overrides,
  };
}

describe("useLocalScores", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty", () => {
    const { result } = renderHook(() => useLocalScores());
    expect(result.current.scores).toEqual([]);
    expect(result.current.best).toBeNull();
  });

  it("records a run and reports its rank", () => {
    const { result } = renderHook(() => useLocalScores());
    let outcome: ReturnType<typeof result.current.record> | undefined;
    act(() => {
      outcome = result.current.record(entry());
    });
    expect(outcome).toEqual({ entryId: "run-1", rank: 1 });
    expect(result.current.scores).toHaveLength(1);
    expect(result.current.best).toBe(1000);
  });

  it("ranks a lower run below a higher one", () => {
    const { result } = renderHook(() => useLocalScores());
    act(() => {
      result.current.record(entry({ id: "high", score: 5000 }));
    });
    let outcome: ReturnType<typeof result.current.record> | undefined;
    act(() => {
      outcome = result.current.record(entry({ id: "low", score: 100 }));
    });
    expect(outcome?.rank).toBe(2);
    expect(result.current.scores[0]?.id).toBe("high");
    expect(result.current.best).toBe(5000);
  });

  it("reports no entryId for a run that missed the table", () => {
    // MAX_SCORES caps the table; a run below every entry on a full board has
    // nothing to point the name field at.
    const { result } = renderHook(() => useLocalScores());
    act(() => {
      for (let i = 0; i < 20; i++) {
        result.current.record(entry({ id: `r${i}`, score: 10_000 + i * 100 }));
      }
    });
    let outcome: ReturnType<typeof result.current.record> | undefined;
    act(() => {
      outcome = result.current.record(entry({ id: "nowhere", score: 1 }));
    });
    expect(outcome?.rank).toBe(-1);
    expect(outcome?.entryId).toBeNull();
  });

  it("persists to localStorage so a reload keeps the table", () => {
    const { result } = renderHook(() => useLocalScores());
    act(() => {
      result.current.record(entry());
    });
    const raw = localStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? "[]")).toHaveLength(1);
  });

  it("renames one entry in place, applying the local 3-char filter", () => {
    // The local table stores *initials*, not display names — `sanitizeName`
    // uppercases, drops non-alphanumerics and truncates to three characters.
    // Asserting the filtered result pins that contract rather than pretending
    // a long name survives.
    const { result } = renderHook(() => useLocalScores());
    act(() => {
      result.current.record(entry());
    });
    act(() => {
      result.current.renameEntry("run-1", "grid-lock!");
    });
    expect(result.current.scores[0]?.name).toBe("GRI");
  });

  it("clears the table", () => {
    const { result } = renderHook(() => useLocalScores());
    act(() => {
      result.current.record(entry());
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.scores).toEqual([]);
    expect(result.current.best).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("[]");
  });

  it("ignores a rename for an id that is not on the board", () => {
    const { result } = renderHook(() => useLocalScores());
    act(() => {
      result.current.record(entry());
    });
    act(() => {
      result.current.renameEntry("missing", "NOPE");
    });
    expect(result.current.scores[0]?.name).toBe("YOU");
  });

  it("rejects an entry that fails validation rather than storing it", () => {
    // `addScore` throws on a malformed entry. The hook must not swallow it into
    // a silent no-op — but it also must not corrupt the table.
    const { result } = renderHook(() => useLocalScores());
    expect(() =>
      act(() => {
        result.current.record(entry({ score: -5 }));
      }),
    ).toThrow();
    expect(result.current.scores).toEqual([]);
  });
});
