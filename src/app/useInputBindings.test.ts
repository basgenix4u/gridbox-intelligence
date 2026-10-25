// @vitest-environment jsdom

/**
 * useInputBindings (task 4.1).
 *
 * These tests exist because the original had this logic inline in a 70-line
 * effect inside `App`, where the only way to exercise it was to mount the whole
 * game and hope. Every rule here is a player-visible contract:
 *
 *  - typing in the name field must not steer the ship
 *  - a held direction key must not repeat-fire into the engine
 *  - blur and tab-hide must pause, and pausing a game that is not running must
 *    be a no-op
 *  - the keypress that ends a run must not also start the next one
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInputBindings, type InputActions, type MenuView, type Phase } from "./useInputBindings.js";

/** Everything the hook is allowed to call, as spies. */
function makeActions(overrides: Partial<InputActions> = {}) {
  const base: InputActions = {
    getPhase: () => "menu",
    getMenuView: () => "main",
    onStartRun: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onMenu: vi.fn(),
    onToggleMute: vi.fn(),
    onShowScores: vi.fn(),
    onHideScores: vi.fn(),
    onPulse: vi.fn(),
    setHeld: vi.fn(),
    clearHeld: vi.fn(),
    canRestart: () => true,
    ...overrides,
  };
  return base;
}

function press(code: string, init: KeyboardEventInit = {}): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true, ...init }));
  });
}

function release(code: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keyup", { code }));
  });
}

describe("useInputBindings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores keystrokes aimed at a text field", () => {
    // The game-over screen has a name input. Typing "w" in it must not also
    // steer the player, and Space must not restart the run.
    const input = document.createElement("input");
    document.body.appendChild(input);

    const actions = makeActions({ getPhase: () => "playing" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    });
    expect(actions.setHeld).not.toHaveBeenCalled();

    const gameOver = makeActions({ getPhase: () => "gameover" });
    renderHook(() =>
      useInputBindings(
        { setHeld: gameOver.setHeld, clearHeld: gameOver.clearHeld },
        gameOver,
      ),
    );
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    });
    expect(gameOver.onStartRun).not.toHaveBeenCalled();

    input.remove();
  });

  it("ignores keystrokes in a contenteditable region", () => {
    // jsdom does not implement `isContentEditable`, so it is defined here
    // rather than relied upon — the point is to exercise *this* guard, not
    // jsdom's.
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true });
    document.body.appendChild(div);

    const actions = makeActions({ getPhase: () => "playing" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    act(() => {
      div.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }));
    });
    expect(actions.setHeld).not.toHaveBeenCalled();
    div.remove();
  });

  it("holds a direction while playing and releases on keyup", () => {
    const actions = makeActions({ getPhase: () => "playing" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );

    press("ArrowUp");
    expect(actions.setHeld).toHaveBeenCalledWith(0, true);
    release("ArrowUp");
    expect(actions.setHeld).toHaveBeenCalledWith(0, false);
  });

  it("maps WASD and the arrow keys to the same directions", () => {
    const actions = makeActions({ getPhase: () => "playing" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );

    const held: number[] = [];
    const withRecorder = makeActions({
      getPhase: () => "playing",
      setHeld: (dir) => {
        held.push(dir);
      },
    });
    renderHook(() =>
      useInputBindings(
        { setHeld: withRecorder.setHeld, clearHeld: withRecorder.clearHeld },
        withRecorder,
      ),
    );

    press("KeyD");
    press("KeyS");
    press("KeyA");
    expect(held).toEqual([1, 2, 3]);
  });

  it("does not re-hold a direction on auto-repeat", () => {
    // A held arrow key fires keydown repeatedly. Feeding every repeat to the
    // engine would be a no-op at best and a desync at worst.
    const actions = makeActions({ getPhase: () => "playing" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );

    press("ArrowRight");
    press("ArrowRight", { repeat: true });
    press("ArrowRight", { repeat: true });
    expect(actions.setHeld).toHaveBeenCalledTimes(1);
  });

  it("ignores movement keys outside play", () => {
    const actions = makeActions({ getPhase: () => "menu" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    press("ArrowLeft");
    expect(actions.setHeld).not.toHaveBeenCalled();
  });

  it("Space starts a run from the main menu", () => {
    const actions = makeActions({ getPhase: () => "menu", getMenuView: () => "main" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    press("Space");
    expect(actions.onStartRun).toHaveBeenCalledTimes(1);
  });

  it("Space does nothing from the scores panel", () => {
    const actions = makeActions({ getPhase: () => "menu", getMenuView: () => "scores" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    press("Space");
    expect(actions.onStartRun).not.toHaveBeenCalled();
  });

  it("Space pulses during play", () => {
    const actions = makeActions({ getPhase: () => "playing" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    press("Space");
    expect(actions.onPulse).toHaveBeenCalledTimes(1);
    expect(actions.onStartRun).not.toHaveBeenCalled();
  });

  it("E and Shift pulse during play", () => {
    const actions = makeActions({ getPhase: () => "playing" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    press("KeyE");
    press("ShiftLeft");
    press("ShiftRight");
    expect(actions.onPulse).toHaveBeenCalledTimes(3);
  });

  it("Escape pauses and unpauses", () => {
    let phase: Phase = "playing";
    const actions = makeActions({ getPhase: () => phase });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );

    press("Escape");
    expect(actions.onPause).toHaveBeenCalledTimes(1);

    phase = "paused";
    press("Escape");
    expect(actions.onResume).toHaveBeenCalledTimes(1);
  });

  it("Escape leaves the scores panel but not the main menu", () => {
    let view: MenuView = "main";
    const actions = makeActions({ getPhase: () => "menu", getMenuView: () => view });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );

    press("Escape");
    expect(actions.onHideScores).not.toHaveBeenCalled();

    view = "scores";
    press("Escape");
    expect(actions.onHideScores).toHaveBeenCalledTimes(1);
  });

  it("R restarts from game over or paused, but not from the menu", () => {
    let phase: Phase = "menu";
    const actions = makeActions({ getPhase: () => phase });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );

    press("KeyR");
    expect(actions.onStartRun).not.toHaveBeenCalled();

    phase = "paused";
    press("KeyR");
    expect(actions.onStartRun).toHaveBeenCalledTimes(1);

    phase = "gameover";
    press("KeyR");
    expect(actions.onStartRun).toHaveBeenCalledTimes(2);
  });

  it("honours the restart guard after game over", () => {
    // The keypress that ended the run must not also start the next one; the
    // caller owns the clock, so the hook just asks.
    const canRestart = vi.fn(() => false);
    const actions = makeActions({ getPhase: () => "gameover", canRestart });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );

    press("KeyR");
    press("Space");
    expect(canRestart).toHaveBeenCalled();
    expect(actions.onStartRun).not.toHaveBeenCalled();
  });

  it("M toggles mute from anywhere", () => {
    const actions = makeActions({ getPhase: () => "menu" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    press("KeyM");
    expect(actions.onToggleMute).toHaveBeenCalledTimes(1);
  });

  it("clears held keys and pauses on blur", () => {
    const actions = makeActions({ getPhase: () => "playing" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(actions.clearHeld).toHaveBeenCalledTimes(1);
    expect(actions.onPause).toHaveBeenCalledTimes(1);
  });

  it("pauses when the tab is hidden", () => {
    const actions = makeActions({ getPhase: () => "playing" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    const spy = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    spy.mockRestore();
    expect(actions.clearHeld).toHaveBeenCalledTimes(1);
    expect(actions.onPause).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the tab becomes visible again", () => {
    const actions = makeActions({ getPhase: () => "playing" });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(actions.onPause).not.toHaveBeenCalled();
  });

  it("reads the phase at event time, not at subscribe time", () => {
    // Subscribing once and reading through a getter is what keeps the listeners
    // from tearing down on every phase change.
    let phase: Phase = "menu";
    const actions = makeActions({ getPhase: () => phase });
    renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );

    phase = "playing";
    press("Space");
    expect(actions.onPulse).toHaveBeenCalledTimes(1);
  });

  it("stops listening after unmount", () => {
    const actions = makeActions({ getPhase: () => "playing" });
    const { unmount } = renderHook(() =>
      useInputBindings({ setHeld: actions.setHeld, clearHeld: actions.clearHeld }, actions),
    );
    unmount();
    press("Space");
    release("ArrowUp");
    expect(actions.onPulse).not.toHaveBeenCalled();
    expect(actions.setHeld).not.toHaveBeenCalled();
  });
});
