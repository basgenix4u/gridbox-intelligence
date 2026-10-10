// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Game } from "@/game/engine";
import { TOUCH_H, TOUCH_W, TouchControls } from "./TouchControls";

/** The D-pad only needs two methods, so a focused stub beats a real engine. */
function fakeGame() {
  return {
    setHeld: vi.fn(),
    inputPulse: vi.fn(),
    inputDir: vi.fn(),
    clearHeld: vi.fn(),
  } as unknown as Game & { setHeld: ReturnType<typeof vi.fn>; inputPulse: ReturnType<typeof vi.fn> };
}

function setup(overrides: Partial<{ pulseReady: boolean; landscape: boolean }> = {}) {
  const game = fakeGame();
  const props = {
    game,
    pulseReady: false,
    landscape: false,
    onPause: vi.fn(),
    onUnlockAudio: vi.fn(),
    ...overrides,
  };
  render(<TouchControls {...props} />);
  const { game: _ignored, ...rest } = props;
  void _ignored;
  return { game, ...rest };
}

describe("TouchControls", () => {
  it("exports stable layout constants", () => {
    expect(TOUCH_H).toBeGreaterThan(0);
    expect(TOUCH_W).toBeGreaterThan(0);
  });

  it("renders four labelled direction buttons", () => {
    setup();
    for (const label of ["Move up", "Move right", "Move down", "Move left"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("renders pause and pulse controls", () => {
    setup();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fire pulse" })).toBeTruthy();
  });

  it("presses and releases a direction", () => {
    const { game } = setup();
    const up = screen.getByRole("button", { name: "Move up" });
    fireEvent.pointerDown(up);
    expect(game.setHeld).toHaveBeenCalledWith(0, true);
    fireEvent.pointerUp(up);
    expect(game.setHeld).toHaveBeenCalledWith(0, false);
  });

  it("releases when the pointer is cancelled or leaves", () => {
    const { game } = setup();
    const right = screen.getByRole("button", { name: "Move right" });
    fireEvent.pointerDown(right);
    fireEvent.pointerCancel(right);
    fireEvent.pointerLeave(right);
    expect(game.setHeld).toHaveBeenCalledWith(1, false);
  });

  it("unlocks audio on the first touch so mobile sound works", () => {
    const { onUnlockAudio } = setup();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Move up" }));
    expect(onUnlockAudio).toHaveBeenCalled();
  });

  it("fires the pulse and unlocks audio", () => {
    const { game, onUnlockAudio } = setup();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Fire pulse" }));
    expect(game.inputPulse).toHaveBeenCalledTimes(1);
    expect(onUnlockAudio).toHaveBeenCalled();
  });

  it("marks the pulse button ready only when charged", () => {
    const { unmount } = render(
      <TouchControls
        game={fakeGame()}
        pulseReady={false}
        landscape={false}
        onPause={() => undefined}
        onUnlockAudio={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Fire pulse" }).className).not.toContain("ready");
    unmount();
    render(
      <TouchControls
        game={fakeGame()}
        pulseReady
        landscape={false}
        onPause={() => undefined}
        onUnlockAudio={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Fire pulse" }).className).toContain("ready");
  });

  it("calls onPause", () => {
    const { onPause } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("suppresses the context menu on long press", () => {
    const { game } = setup();
    const up = screen.getByRole("button", { name: "Move up" });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    up.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(game.setHeld).not.toHaveBeenCalled();
  });
});
