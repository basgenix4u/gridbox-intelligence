// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PauseScreen } from "./PauseScreen";

function setup(overrides = {}) {
  const props = {
    onResume: vi.fn(),
    onRestart: vi.fn(),
    onMenu: vi.fn(),
    muted: false,
    onToggleMute: vi.fn(),
    isTouch: false,
    score: 4_321,
    ...overrides,
  };
  render(<PauseScreen {...props} />);
  return props;
}

describe("PauseScreen", () => {
  it("shows the paused heading and the carried score", () => {
    setup();
    expect(screen.getByText("PAUSED")).toBeTruthy();
    expect(screen.getByText("4321")).toBeTruthy();
  });

  it("wires every control", () => {
    const p = setup();
    screen.getByRole("button", { name: "Resume" }).click();
    screen.getByRole("button", { name: "Restart" }).click();
    screen.getByRole("button", { name: "Main Menu" }).click();
    screen.getByRole("button", { name: "Mute" }).click();
    expect(p.onResume).toHaveBeenCalledTimes(1);
    expect(p.onRestart).toHaveBeenCalledTimes(1);
    expect(p.onMenu).toHaveBeenCalledTimes(1);
    expect(p.onToggleMute).toHaveBeenCalledTimes(1);
  });

  it("reflects the muted state on the toggle", () => {
    setup({ muted: true });
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
  });

  it("shows keyboard hints on desktop and hides them on touch", () => {
    const { unmount } = render(
      <PauseScreen
        onResume={() => undefined}
        onRestart={() => undefined}
        onMenu={() => undefined}
        muted={false}
        onToggleMute={() => undefined}
        isTouch={false}
        score={0}
      />,
    );
    expect(screen.getByText(/RESUME/)).toBeTruthy();
    unmount();
    render(
      <PauseScreen
        onResume={() => undefined}
        onRestart={() => undefined}
        onMenu={() => undefined}
        muted={false}
        onToggleMute={() => undefined}
        isTouch
        score={0}
      />,
    );
    expect(screen.queryByText(/RESUME/)).toBeNull();
  });
});
