// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installCanvasContextStub } from "@/test/domStubs";
import type { Game } from "@/game/engine";
import { GameCanvas } from "./GameCanvas";

/**
 * Covers the component's own contract — sizing, pointer handling and listener
 * cleanup. A stubbed 2D context is installed so the real effect body runs; the
 * drawing itself is verified by the E2E and visual suites instead.
 */
function requireCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas was not rendered");
  return canvas;
}

function fakeGame() {
  return {
    resize: vi.fn(),
    layout: { W: 320, H: 420, cell: 32, ox: 10, oy: 70, hudH: 60, botH: 30, pad: 10, dpr: 1 },
    inputDir: vi.fn(),
    setHeld: vi.fn(),
  } as unknown as Game & { resize: ReturnType<typeof vi.fn>; inputDir: ReturnType<typeof vi.fn> };
}

beforeAll(() => {
  // Run the real code path: jsdom returns null from getContext without this.
  installCanvasContextStub();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(props: Partial<Parameters<typeof GameCanvas>[0]> = {}) {
  const game = fakeGame();
  const onUnlockAudio = vi.fn();
  render(<GameCanvas game={game} reserveBottom={0} reserveRight={0} onUnlockAudio={onUnlockAudio} {...props} />);
  return { game, onUnlockAudio };
}

describe("GameCanvas", () => {
  it("renders a canvas element", () => {
    setup();
    const canvas = document.querySelector("canvas");
    expect(canvas).toBeTruthy();
  });

  it("sizes the game from the available viewport on mount", () => {
    const { game } = setup();
    expect(game.resize).toHaveBeenCalled();
  });

  it("unlocks audio on first interaction", () => {
    const { onUnlockAudio } = setup();
    const canvas = requireCanvas();
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 10, clientY: 10 });
    expect(onUnlockAudio).toHaveBeenCalled();
  });

  it("translates a rightward swipe into a rightward input", () => {
    const { game } = setup();
    const canvas = requireCanvas();
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100 + 60, clientY: 100 });
    expect(game.inputDir).toHaveBeenCalledWith(1);
  });

  it("translates a downward swipe into a downward input", () => {
    const { game } = setup();
    const canvas = requireCanvas();
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100, clientY: 100 + 60 });
    expect(game.inputDir).toHaveBeenCalledWith(2);
  });

  it("ignores movement below the swipe threshold so taps do not move the player", () => {
    const { game } = setup();
    const canvas = requireCanvas();
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100 + 5, clientY: 100 });
    expect(game.inputDir).not.toHaveBeenCalled();
  });

  it("ignores movement from a different pointer id", () => {
    const { game } = setup();
    const canvas = requireCanvas();
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 99, clientX: 100 + 80, clientY: 100 });
    expect(game.inputDir).not.toHaveBeenCalled();
  });

  it("stops tracking once the pointer ends", () => {
    const { game } = setup();
    const canvas = requireCanvas();
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100 + 80, clientY: 100 });
    expect(game.inputDir).not.toHaveBeenCalled();
  });

  it("removes its listeners on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <GameCanvas game={fakeGame()} reserveBottom={0} reserveRight={0} onUnlockAudio={() => undefined} />,
    );
    unmount();
    const removed = removeSpy.mock.calls.map((c) => String(c[0]));
    expect(removed).toContain("resize");
    expect(removed).toContain("orientationchange");
    removeSpy.mockRestore();
  });

  it("renders nothing but the canvas", () => {
    setup();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
