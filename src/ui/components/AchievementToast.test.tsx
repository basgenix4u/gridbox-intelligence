// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AchievementDef } from "@/game/achievements";
import { AchievementToast } from "./AchievementToast";

const def: AchievementDef = {
  id: "chip-100",
  name: "Data Miner",
  desc: "Collect 100 data chips in total.",
  glyph: "◈",
  target: 100,
  endowed: 25,
  measure: (p) => p.totalChips,
};

describe("AchievementToast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces the unlock politely", () => {
    const noop = (): void => undefined;
    render(<AchievementToast achievement={def} onDone={noop} />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("UNLOCKED")).toBeTruthy();
    expect(screen.getByText("Data Miner")).toBeTruthy();
  });

  it("dismisses itself after the toast window", () => {
    const onDone = vi.fn();
    render(<AchievementToast achievement={def} onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(3400);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
