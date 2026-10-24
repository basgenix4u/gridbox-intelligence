// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Game } from "@/game/engine";
import { createSilentAudio } from "@/core/adapters/silentAudio";
import { useStallGuard } from "./useStallGuard";

/**
 * Covers the App-side contract of the stall guard: a stalled loop pauses the
 * run and raises the notice; recovery (automatic or manual) clears both. The
 * watchdog's own decision logic is covered in `src/game/rafWatchdog.test.ts`.
 */
function makeGame(): Game {
  return new Game(createSilentAudio());
}

describe("useStallGuard", () => {
  it("pauses the game and raises the flag when a stall is reported", () => {
    const game = makeGame();
    game.resume(); // constructor leaves it in attract mode, unpaused
    const { result } = renderHook(() => useStallGuard(game));
    act(() => result.current.onStall());
    expect(result.current.stalled).toBe(true);
    expect(game.paused).toBe(true);
  });

  it("clears the flag and resumes the game on automatic recovery", () => {
    const game = makeGame();
    const { result } = renderHook(() => useStallGuard(game));
    act(() => result.current.onStall());
    act(() => result.current.onStallRecover());
    expect(result.current.stalled).toBe(false);
    expect(game.paused).toBe(false);
  });

  it("manual resume clears the flag and unpauses the game", () => {
    const game = makeGame();
    const { result } = renderHook(() => useStallGuard(game));
    act(() => result.current.onStall());
    act(() => result.current.resume());
    expect(result.current.stalled).toBe(false);
    expect(game.paused).toBe(false);
  });

  it("starts idle — no notice before any stall", () => {
    const game = makeGame();
    const { result } = renderHook(() => useStallGuard(game));
    expect(result.current.stalled).toBe(false);
  });
});
