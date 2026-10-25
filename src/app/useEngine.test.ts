// @vitest-environment jsdom

/**
 * useEngine (task 4.1).
 *
 * The engine is a 60 Hz mutable simulation that React happens to hold. This
 * hook exists so the mutation lives in one auditable place, and the point of
 * these tests is to prove the *seam* works: a caller can drive the engine
 * without touching a field, and the callbacks survive a re-render.
 *
 * `Game` constructs a canvas-backed particle system and calls `startAttract()`
 * in its constructor, so the canvas stub has to be installed before the hook
 * runs — hence the `beforeAll`.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installCanvasContextStub } from "../test/domStubs.js";
import type { RunStats } from "../game/types.js";
import { useEngine } from "./useEngine.js";

const RUN: RunStats = {
  score: 100,
  level: 1,
  chips: 7,
  maxCombo: 2,
  kills: 1,
  timeMs: 1000,
  bestPulseKills: 0,
};

beforeAll(() => {
  installCanvasContextStub();
});

/** The signal under test is not the one being ignored. */
function ignore(): void {
  /* deliberately unused in this test */
}

describe("useEngine", () => {
  it("hands out a live engine and synth", () => {
    const { result } = renderHook(() => useEngine(false));
    expect(result.current.game).toBeTruthy();
    expect(result.current.synth).toBeTruthy();
  });

  it("keeps the same engine instance across re-renders", () => {
    const { result, rerender } = renderHook(({ muted }) => useEngine(muted), {
      initialProps: { muted: false },
    });
    const first = result.current.game;
    rerender({ muted: true });
    expect(result.current.game).toBe(first);
  });

  it("applies the mute preference through the verb, not a field write", () => {
    const { result } = renderHook(() => useEngine(true));
    expect(result.current.synth.muted).toBe(true);
  });

  it("propagates touch and landscape detection", () => {
    const { result } = renderHook(() => useEngine(false));
    expect(typeof result.current.isTouch).toBe("boolean");
    expect(typeof result.current.isLandscape).toBe("boolean");
    expect(result.current.game.isTouch).toBe(result.current.isTouch);
  });

  it("starts a run and moves out of attract mode", () => {
    const { result } = renderHook(() => useEngine(false));
    expect(result.current.game.mode).toBe("attract");
    act(() => {
      result.current.startRun(5000);
    });
    expect(result.current.game.mode).toBe("playing");
    // The best-score hint drives the in-run "NEW BEST" moment.
    expect(result.current.game.bestScore).toBe(5000);
  });

  it("pauses and resumes", () => {
    const { result } = renderHook(() => useEngine(false));
    act(() => {
      result.current.startRun(0);
    });
    act(() => {
      result.current.pause();
    });
    expect(result.current.game.paused).toBe(true);
    act(() => {
      result.current.resume();
    });
    expect(result.current.game.paused).toBe(false);
  });

  it("returns to attract mode", () => {
    const { result } = renderHook(() => useEngine(false));
    act(() => {
      result.current.startRun(0);
    });
    act(() => {
      result.current.toAttract();
    });
    expect(result.current.game.mode).toBe("attract");
  });

  it("applies the reduced-motion preference", () => {
    const { result } = renderHook(() => useEngine(false));
    act(() => {
      result.current.setReducedMotion(true);
    });
    expect(result.current.game.reducedMotion).toBe(true);
  });

  it("delivers engine events to the latest callbacks after a re-render", () => {
    // The whole reason the callbacks go through a ref: a closure registered on
    // render N must still be the one that fires after render N+1.
    // `tick` is a prop only to force a re-render; it is never read.
    const { result, rerender } = renderHook(({ tick: _tick }) => useEngine(false), {
      initialProps: { tick: 0 },
    });

    const seen: RunStats[] = [];
    act(() => {
      result.current.setCallbacks({ onGameOver: (s) => seen.push(s), onChargeReady: ignore });
    });

    rerender({ tick: 1 });

    act(() => {
      result.current.game.callbacks.onGameOver(RUN);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(RUN);
  });

  it("replaces the callbacks when they are re-registered", () => {
    const { result } = renderHook(() => useEngine(false));
    const first = vi.fn();
    const second = vi.fn();

    act(() => {
      result.current.setCallbacks({ onGameOver: first, onChargeReady: ignore });
    });
    act(() => {
      result.current.setCallbacks({ onGameOver: second, onChargeReady: ignore });
    });
    act(() => {
      result.current.game.callbacks.onGameOver(RUN);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("forwards the charge-ready signal", () => {
    const { result } = renderHook(() => useEngine(false));
    const onChargeReady = vi.fn();
    act(() => {
      result.current.setCallbacks({ onGameOver: ignore, onChargeReady });
    });
    act(() => {
      result.current.game.callbacks.onChargeReady(true);
    });
    expect(onChargeReady).toHaveBeenCalledWith(true);
  });

  it("does not throw when the engine fires before any callbacks are set", () => {
    const { result } = renderHook(() => useEngine(false));
    expect(() =>
      act(() => {
        result.current.game.callbacks.onGameOver(RUN);
      }),
    ).not.toThrow();
  });
});
