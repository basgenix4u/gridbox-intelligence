// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CURRENT_SCORING_VERSION, type ScoreEntry } from "@/game/scoring";
import type { RunStats } from "@/game/types";
import { GameOverScreen } from "./GameOverScreen";

const stats: RunStats = {
  score: 8_400,
  level: 12,
  chips: 77,
  maxCombo: 8,
  kills: 9,
  timeMs: 92_000,
  bestPulseKills: 3,
};

function entry(overrides: Partial<ScoreEntry> = {}): ScoreEntry {
  return {
    id: "run-1",
    name: "ABC",
    score: 8_400,
    level: 12,
    chips: 77,
    maxCombo: 8,
    date: Date.UTC(2026, 9, 9),
    scoringVersion: CURRENT_SCORING_VERSION,
    ...overrides,
  };
}

function setup(overrides: Partial<Parameters<typeof GameOverScreen>[0]> = {}) {
  const props = {
    stats,
    rank: -1,
    entryId: null,
    name: "ABC",
    onNameChange: vi.fn(),
    scores: [] as ScoreEntry[],
    onRestart: vi.fn(),
    onMenu: vi.fn(),
    muted: false,
    onToggleMute: vi.fn(),
    isTouch: false,
    ...overrides,
  };
  render(<GameOverScreen {...props} />);
  return props;
}

describe("GameOverScreen", () => {
  it("shows the run summary", () => {
    setup();
    expect(screen.getByText("SYSTEM BREACHED")).toBeTruthy();
    expect(screen.getByText("8400")).toBeTruthy();
    expect(screen.getByText("SURVIVED 1:32")).toBeTruthy();
  });

  it("renders every stat tile", () => {
    setup();
    for (const label of ["LEVEL", "CHIPS", "COMBO", "KILLS"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("77")).toBeTruthy();
    expect(screen.getByText("×8")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
  });

  it("does not offer initials unless the run made the table", () => {
    setup({ rank: -1, entryId: null });
    expect(screen.queryByLabelText("INITIALS")).toBeNull();
  });

  it("celebrates a new number one", () => {
    setup({ rank: 1, entryId: "run-1", scores: [entry()] });
    expect(screen.getByText("NEW #1 HIGH SCORE")).toBeTruthy();
    expect(screen.getByLabelText("INITIALS")).toBeTruthy();
  });

  it("reports a lower new-high rank", () => {
    setup({ rank: 3, entryId: "run-1", scores: [entry()] });
    expect(screen.getByText(/NEW HIGH SCORE/)).toBeTruthy();
    expect(screen.getByText(/#3/)).toBeTruthy();
  });

  it("caps initials at three characters", () => {
    setup({ rank: 1, entryId: "run-1", scores: [entry()] });
    expect(screen.getByLabelText<HTMLInputElement>("INITIALS").maxLength).toBe(3);
  });

  it("sanitises typed initials before passing them up", () => {
    const onNameChange = vi.fn();
    setup({ rank: 1, entryId: "run-1", scores: [entry()], onNameChange });
    const input = screen.getByLabelText<HTMLInputElement>("INITIALS");
    input.focus();
    // React only sees programmatic input when the native setter is used.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "a-9!x");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onNameChange).toHaveBeenCalledWith("A9X");
  });

  it("wires restart, menu and mute", () => {
    const p = setup();
    screen.getByRole("button", { name: "Restart" }).click();
    screen.getByRole("button", { name: "Main Menu" }).click();
    screen.getByRole("button", { name: "Mute" }).click();
    expect(p.onRestart).toHaveBeenCalledTimes(1);
    expect(p.onMenu).toHaveBeenCalledTimes(1);
    expect(p.onToggleMute).toHaveBeenCalledTimes(1);
  });

  it("shows the leaderboard only when there are scores", () => {
    const { unmount } = render(
      <GameOverScreen
        stats={stats}
        rank={-1}
        entryId={null}
        name="ABC"
        onNameChange={() => undefined}
        scores={[]}
        onRestart={() => undefined}
        onMenu={() => undefined}
        muted={false}
        onToggleMute={() => undefined}
        isTouch={false}
      />,
    );
    expect(screen.queryByText("LEADERBOARD")).toBeNull();
    unmount();
    render(
      <GameOverScreen
        stats={stats}
        rank={1}
        entryId="run-1"
        name="ABC"
        onNameChange={() => undefined}
        scores={[entry()]}
        onRestart={() => undefined}
        onMenu={() => undefined}
        muted={false}
        onToggleMute={() => undefined}
        isTouch={false}
      />,
    );
    expect(screen.getByText("LEADERBOARD")).toBeTruthy();
  });
});
