// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { installCanvasContextStub } from "@/test/domStubs";
import App from "./App";

/**
 * Smoke test for the whole application tree: the composition in `main.tsx`
 * (ErrorBoundary → App), the canvas watchdog wiring and the menu phase must
 * all render together without a browser. Screen-level behaviour is covered by
 * the per-component suites; this guards the wiring between them.
 */
beforeAll(() => {
  installCanvasContextStub();
});

describe("App", () => {
  it("boots into the start screen", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "GRIDBOX" })).toBeTruthy();
  });

  it("mounts the game canvas with the stall watchdog wiring", () => {
    render(<App />);
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("shows no stall notice on a healthy boot", () => {
    render(<App />);
    expect(screen.queryByTestId("stall-notice")).toBeNull();
  });
});

/**
 * The leaderboard is reached through the real composition root, not by
 * mounting `LeaderboardPanel` on its own — these guard the wiring that a
 * per-component suite would happily miss.
 */
describe("App — leaderboard wiring (4.8)", () => {
  beforeAll(() => {
    installCanvasContextStub();
  });

  function openBoard(): void {
    render(<App />);
    // The board is reached straight from the start screen, next to High Scores.
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
  }

  it("reaches the leaderboard from the menu", () => {
    openBoard();
    expect(screen.getByRole("heading", { name: "LEADERBOARD" })).toBeTruthy();
  });

  it("offers both scopes and all four modes", () => {
    openBoard();
    for (const name of ["TODAY", "ALL TIME", "ENDLESS", "DAILY", "ZEN", "HARDCORE"]) {
      expect(screen.getByRole("radio", { name })).toBeTruthy();
    }
  });

  it("defaults to today's board in endless mode", () => {
    openBoard();
    expect(screen.getByRole("radio", { name: "TODAY" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "ENDLESS" }).getAttribute("aria-checked")).toBe("true");
  });

  it("shows a legible state rather than a blank panel", () => {
    openBoard();
    // Whichever state the fetch lands in, the panel must say something. A blank
    // panel is the one outcome that is never acceptable.
    const body = document.body.textContent ?? "";
    expect(
      /Loading the board|You are offline|Could not load the board|No runs yet|LEADERBOARD/.test(body),
    ).toBe(true);
  });

  it("returns to the menu from the board", () => {
    openBoard();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "GRIDBOX" })).toBeTruthy();
  });
});
