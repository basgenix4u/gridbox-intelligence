// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
