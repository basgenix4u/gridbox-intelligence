// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KINDS } from "@/game/constants";
import { StartScreen } from "./StartScreen";

function setup(overrides: Partial<Parameters<typeof StartScreen>[0]> = {}) {
  const props = {
    onPlay: vi.fn(),
    onScores: vi.fn(),
    muted: false,
    onToggleMute: vi.fn(),
    best: null,
    isTouch: false,
    ...overrides,
  };
  render(<StartScreen {...props} />);
  return props;
}

describe("StartScreen", () => {
  it("renders the title and tagline", () => {
    setup();
    expect(screen.getByText("GRIDBOX")).toBeTruthy();
    expect(screen.getByText("INTELLIGENCE")).toBeTruthy();
  });

  it("wires Play and High Scores", () => {
    const p = setup();
    screen.getByRole("button", { name: "Play" }).click();
    screen.getByRole("button", { name: "High Scores" }).click();
    expect(p.onPlay).toHaveBeenCalledTimes(1);
    expect(p.onScores).toHaveBeenCalledTimes(1);
  });

  it("hides the best score when there is none", () => {
    setup({ best: null });
    expect(screen.queryByText("BEST")).toBeNull();
  });

  it("shows the best score when present", () => {
    setup({ best: 12_780 });
    expect(screen.getByText("BEST")).toBeTruthy();
    expect(screen.getByText("12780")).toBeTruthy();
  });

  it("lists every threat tier", () => {
    setup();
    for (const kind of KINDS) expect(screen.getByText(kind.name)).toBeTruthy();
  });

  it("prompts with the keyboard on desktop and tap on touch", () => {
    const { unmount } = render(
      <StartScreen
        onPlay={() => undefined}
        onScores={() => undefined}
        muted={false}
        onToggleMute={() => undefined}
        best={null}
        isTouch={false}
      />,
    );
    expect(screen.getByText("PRESS ENTER TO START")).toBeTruthy();
    unmount();
    render(
      <StartScreen
        onPlay={() => undefined}
        onScores={() => undefined}
        muted={false}
        onToggleMute={() => undefined}
        best={null}
        isTouch
      />,
    );
    expect(screen.getByText("TAP PLAY TO START")).toBeTruthy();
  });

  it("explains the pulse cost", () => {
    setup();
    expect(screen.getByText(/after 5 chips/)).toBeTruthy();
  });
});
