// @vitest-environment jsdom

/**
 * LeaderboardPanel (task 4.8, the UI half of 4.2).
 *
 * The five states are the product here, so each one is asserted by the sentence
 * a player would actually read. The two that matter most:
 *
 *  - **empty is not an error.** "No runs yet" must not appear when the request
 *    failed, and an error must not be dressed up as an empty board.
 *  - **offline shows no retry button.** There is nothing to retry until the
 *    network returns, and offering a button that cannot work is worse than
 *    saying nothing.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LeaderboardRow } from "../../shared/contracts.js";
import type { UseLeaderboardResult } from "../../app/useLeaderboard.js";
import { LeaderboardPanel } from "./LeaderboardPanel";

const ROW: LeaderboardRow = {
  rank: 1,
  playerId: "11111111-1111-4111-8111-111111111111",
  initials: "LEV",
  score: 900,
  level: 10,
  isYou: false,
};

const YOU_ROW: LeaderboardRow = {
  rank: 2,
  playerId: "22222222-2222-4222-8222-222222222222",
  initials: "YOU",
  score: 500,
  level: 5,
  isYou: true,
};

/** Builds the hook's result shape without running the hook. */
function board(overrides: Partial<UseLeaderboardResult> = {}): UseLeaderboardResult {
  return {
    status: "ready",
    data: [ROW],
    error: null,
    failures: 0,
    retrying: false,
    refresh: vi.fn(),
    scope: "global",
    mode: "endless",
    day: null,
    hasRows: true,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<UseLeaderboardResult> = {}, handlers: {
  onScope?: (s: "daily" | "global") => void;
  onMode?: (m: "endless" | "daily" | "zen" | "hardcore") => void;
  onBack?: () => void;
  you?: string | null;
} = {}) {
  const onScope = handlers.onScope ?? vi.fn();
  const onMode = handlers.onMode ?? vi.fn();
  const onBack = handlers.onBack ?? vi.fn();
  render(
    <LeaderboardPanel
      board={board(overrides)}
      onScope={onScope}
      onMode={onMode}
      onBack={onBack}
      you={handlers.you ?? null}
    />,
  );
  return { onScope, onMode, onBack };
}

describe("LeaderboardPanel", () => {
  it("renders the rows when ready", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "LEADERBOARD" })).toBeTruthy();
    expect(screen.getByText("LEV")).toBeTruthy();
    expect(screen.getByText("900")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
  });

  it("marks the player's own row", () => {
    renderPanel({ data: [ROW, YOU_ROW] }, { you: YOU_ROW.playerId });
    // The row is highlighted *and* labelled, so the highlight is not the only
    // signal — colour alone is not an accessible one.
    const badge = screen.getByTestId("you-badge");
    expect(badge.textContent).toBe("YOU");
    const row = badge.closest("tr");
    expect(row?.className).toContain("bloom");
  });

  it("does not mark anyone when the player is not on the board", () => {
    renderPanel({ data: [ROW] }, { you: null });
    expect(screen.queryByTestId("you-badge")).toBeNull();
  });

  it("labels the daily scope with its own heading", () => {
    renderPanel({ scope: "daily", day: "2026-10-25" });
    // The word appears twice — the heading and the scope radio — so the radio
    // is the one that must carry the state.
    expect(screen.getByRole("radio", { name: "TODAY" }).getAttribute("aria-checked")).toBe("true");
  });

  it("says loading while the first request is in flight", () => {
    renderPanel({ status: "loading", data: null });
    expect(screen.getByText("Loading the board…")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("invites the player when the board is empty", () => {
    // An empty board is a fact about the world, not a failure.
    renderPanel({ status: "empty", data: [], hasRows: false });
    expect(screen.getByText("No runs yet")).toBeTruthy();
    expect(screen.getByText("Be the first on the board.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("invites the player onto today's board specifically", () => {
    renderPanel({ status: "empty", data: [], hasRows: false, scope: "daily" });
    expect(screen.getByText("Be the first on today's board.")).toBeTruthy();
  });

  it("explains being offline and offers no retry", () => {
    // No network is not worth a retry button: it cannot work, and the hook is
    // already listening for the `online` event.
    renderPanel({ status: "offline", data: null });
    expect(screen.getByText("You are offline")).toBeTruthy();
    expect(screen.getByText(/will appear as soon as you are back online/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("shows the server's message and a retry on error", () => {
    renderPanel({
      status: "error",
      data: null,
      error: { message: "board unavailable", retryable: true },
    });
    expect(screen.getByText("Could not load the board")).toBeTruthy();
    expect(screen.getByText("board unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the last board visible while a retry fails", () => {
    // A stale board beats a blank one.
    renderPanel({
      status: "error",
      data: [ROW],
      error: { message: "board unavailable", retryable: true },
    });
    expect(screen.getByText("LEV")).toBeTruthy();
    expect(screen.getByText("board unavailable")).toBeTruthy();
  });

  it("calls refresh when retry is pressed", () => {
    const refresh = vi.fn();
    renderPanel({
      status: "error",
      data: null,
      error: { message: "boom", retryable: true },
      refresh,
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows a syncing hint while refreshing data already on screen", () => {
    renderPanel({ retrying: true, data: [ROW] });
    expect(screen.getByText("SYNCING")).toBeTruthy();
  });

  it("does not show a syncing hint on the first load", () => {
    renderPanel({ retrying: true, data: null, status: "loading" });
    expect(screen.queryByText("SYNCING")).toBeNull();
  });

  it("switches scope and mode through radio groups", () => {
    const { onScope, onMode } = renderPanel();

    const today = screen.getByRole("radio", { name: "TODAY" });
    expect(today.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(today);
    expect(onScope).toHaveBeenCalledWith("daily");

    fireEvent.click(screen.getByRole("radio", { name: "ZEN" }));
    expect(onMode).toHaveBeenCalledWith("zen");
  });

  it("marks the active scope and mode for assistive tech", () => {
    renderPanel({ scope: "daily", mode: "zen" });
    expect(screen.getByRole("radio", { name: "TODAY" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "ALL TIME" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: "ZEN" }).getAttribute("aria-checked")).toBe("true");
  });

  it("goes back", () => {
    const onBack = vi.fn();
    renderPanel({}, { onBack });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("has a labelled table so screen readers announce the scope", () => {
    renderPanel({ data: [ROW, YOU_ROW] }, { you: YOU_ROW.playerId });
    const table = screen.getByRole("table");
    expect(table.querySelector("caption")?.textContent).toContain("2 entries");
  });

  it("formats large scores with separators", () => {
    renderPanel({ data: [{ ...ROW, score: 1_234_567 }] });
    expect(screen.getByText("1,234,567")).toBeTruthy();
  });
});
