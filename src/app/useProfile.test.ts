// @vitest-environment jsdom

/**
 * useProfile (task 4.1).
 *
 * The two behaviours worth guarding are the ones the original got subtly right
 * and a refactor would plausibly lose:
 *
 *  1. **Mount reconciliation is silent.** A profile restored on a new device
 *     already satisfies goals that were never celebrated on the old one. Those
 *     must be claimed without a toast — a celebration for something the player
 *     did not just do is noise.
 *  2. **Toasts queue.** One run can unlock several achievements, and the toast
 *     component shows one at a time, so `dismissToast` must walk the queue.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { RunStats } from "../game/types.js";
import { useProfile } from "./useProfile.js";

const KEY = "gridbox-intelligence.profile.v1";

const RUN: RunStats = {
  score: 1200,
  level: 4,
  chips: 30,
  maxCombo: 5,
  kills: 12,
  timeMs: 60_000,
  bestPulseKills: 3,
};

describe("useProfile", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts from a default profile and persists it", () => {
    const { result } = renderHook(() => useProfile());
    expect(result.current.profile.runsPlayed).toBe(0);
    expect(localStorage.getItem(KEY)).toBeTruthy();
  });

  it("folds a run into the profile and reports a new best", () => {
    const { result } = renderHook(() => useProfile());
    let outcome: ReturnType<typeof result.current.record> | undefined;
    act(() => {
      outcome = result.current.record(RUN);
    });
    expect(outcome?.newBest).toBe(true);
    expect(result.current.profile.runsPlayed).toBe(1);
    expect(result.current.profile.bestScore).toBe(1200);
    expect(result.current.profile.totalChips).toBe(30);
  });

  it("does not report a new best for a run below the record", () => {
    const { result } = renderHook(() => useProfile());
    act(() => {
      result.current.record(RUN);
    });
    let outcome: ReturnType<typeof result.current.record> | undefined;
    act(() => {
      outcome = result.current.record({ ...RUN, score: 10 });
    });
    expect(outcome?.newBest).toBe(false);
    expect(result.current.profile.bestScore).toBe(1200);
    expect(result.current.profile.runsPlayed).toBe(2);
  });

  it("claims an already-satisfied goal on mount without a toast", () => {
    // A profile restored from another device: "play one run" is satisfied by
    // data the player did not just produce.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        // `parseProfile` rejects a table missing any of these, silently
        // falling back to defaults — which would make this test vacuous.
        version: 1,
        createdAt: 1_700_000_000_000,
        runsPlayed: 5,
        totalChips: 100,
        totalKills: 50,
        totalPlayMs: 300_000,
        bestScore: 9000,
        bestLevel: 9,
        maxCombo: 8,
        bestPulseKills: 6,
        streak: { current: 1, longest: 3, lastDay: "2026-10-25" },
        accent: "cyan",
        unlocked: [],
      }),
    );

    const { result } = renderHook(() => useProfile());
    expect(result.current.toast).toBeNull();
    expect(result.current.profile.unlocked.length).toBeGreaterThan(0);
  });

  it("queues several unlocks and walks them one dismiss at a time", () => {
    const { result } = renderHook(() => useProfile());
    // One run, four goals met at once: first chip, an 8-combo, a 5-kill pulse
    // and level 10. `maxCombo` and `bestPulseKills` are clamped to >= 1 by the
    // profile parser, so a zeroed run would satisfy nothing.
    act(() => {
      result.current.record({
        ...RUN,
        score: 0,
        chips: 30,
        kills: 0,
        maxCombo: 8,
        bestPulseKills: 5,
        level: 10,
      });
    });
    expect(result.current.profile.unlocked.length).toBeGreaterThan(1);
    expect(result.current.toast).not.toBeNull();

    // Dismissing must not lose the queue: the next toast appears, and the
    // queue empties to null rather than getting stuck.
    const first = result.current.toast;
    act(() => {
      result.current.dismissToast();
    });
    const second = result.current.toast;
    expect(second).not.toBe(first);

    let guard = 0;
    while (result.current.toast !== null && guard < 20) {
      act(() => {
        result.current.dismissToast();
      });
      guard += 1;
    }
    expect(result.current.toast).toBeNull();
  });

  it("changes the accent without disturbing progression", () => {
    const { result } = renderHook(() => useProfile());
    act(() => {
      result.current.record(RUN);
    });
    act(() => {
      result.current.setAccent("magenta");
    });
    expect(result.current.profile.accent).toBe("magenta");
    expect(result.current.profile.bestScore).toBe(1200);
  });

  it("reports the nearest goals for the given count", () => {
    const { result } = renderHook(() => useProfile());
    act(() => {
      result.current.record(RUN);
    });
    expect(result.current.nearest(3)).toHaveLength(3);
    expect(result.current.nearest(1)).toHaveLength(1);
  });
});
