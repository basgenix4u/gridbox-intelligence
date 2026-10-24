// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CURRENT_SCORING_VERSION, type ScoreEntry } from "@/game/scoring";
import { ScoreTable, ScoresPanel } from "./ScoresPanel";

function entry(overrides: Partial<ScoreEntry> = {}): ScoreEntry {
  return {
    id: "run-1",
    name: "ABC",
    score: 5_200,
    level: 10,
    chips: 63,
    maxCombo: 8,
    date: Date.UTC(2026, 9, 9),
    scoringVersion: CURRENT_SCORING_VERSION,
    ...overrides,
  };
}

describe("ScoreTable", () => {
  it("renders an empty state when there are no runs", () => {
    render(<ScoreTable scores={[]} />);
    expect(screen.getByText(/No runs recorded yet/)).toBeTruthy();
  });

  it("renders one row per entry, ranked from one", () => {
    render(<ScoreTable scores={[entry({ id: "a", score: 300 }), entry({ id: "b", score: 200 })]} />);
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 rows
    expect(screen.getByText("300")).toBeTruthy();
    expect(screen.getByText("200")).toBeTruthy();
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 8 }, (_, i) => entry({ id: `r${i}`, score: 100 - i }));
    render(<ScoreTable scores={many} limit={3} />);
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3
  });

  it("labels a legacy-formula score and leaves a current one unlabelled", () => {
    render(<ScoreTable scores={[entry({ id: "old", scoringVersion: 1 }), entry({ id: "new", score: 100 })]} />);
    // The badge is present for the v1 run, with the version in its tooltip.
    const badge = screen.getByTitle("Scored with the previous formula (v1)");
    expect(badge.textContent).toBe("v1");
    // And only one badge exists — the current run is not labelled.
    expect(screen.getAllByTitle(/previous formula/)).toHaveLength(1);
  });

  it("renders a placeholder for a blank name", () => {
    render(<ScoreTable scores={[entry({ name: "" })]} />);
    expect(screen.getByText("---")).toBeTruthy();
  });

  it("hides the combo and date columns in compact mode", () => {
    render(<ScoreTable scores={[entry()]} compact />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).not.toContain("COMBO");
    expect(headers).not.toContain("DATE");
  });

  it("shows the combo and date columns in full mode", () => {
    render(<ScoreTable scores={[entry()]} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("COMBO");
    expect(headers).toContain("DATE");
  });
});

describe("ScoresPanel", () => {
  it("renders the heading", () => {
    render(<ScoresPanel scores={[]} onBack={() => undefined} onClear={() => undefined} />);
    expect(screen.getByText("HIGH SCORES")).toBeTruthy();
  });

  it("calls onBack", () => {
    const onBack = vi.fn();
    render(<ScoresPanel scores={[]} onBack={onBack} onClear={() => undefined} />);
    screen.getByRole("button", { name: "Back" }).click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("hides Clear when the table is empty", () => {
    render(<ScoresPanel scores={[]} onBack={() => undefined} onClear={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("requires a second click before clearing (destructive-action guard)", () => {
    const onClear = vi.fn();
    render(<ScoresPanel scores={[entry()]} onBack={() => undefined} onClear={onClear} />);
    const clear = screen.getByRole("button", { name: "Clear" });
    fireEvent.click(clear);
    expect(onClear).not.toHaveBeenCalled(); // first click only arms it
    expect(screen.getByRole("button", { name: "Sure?" })).toBeTruthy();
    screen.getByRole("button", { name: "Sure?" }).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
