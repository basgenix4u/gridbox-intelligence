// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, MuteButton, Stat } from "./ui";

describe("Button", () => {
  it("renders children and defaults to type=button", () => {
    render(<Button>Play</Button>);
    const btn = screen.getByRole("button", { name: "Play" });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    screen.getByRole("button", { name: "Go" }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies the primary variant class", () => {
    render(<Button variant="primary">A</Button>);
    expect(screen.getByRole("button").className).toContain("btn-primary");
  });

  it("applies the danger variant class", () => {
    render(<Button variant="danger">B</Button>);
    expect(screen.getByRole("button").className).toContain("btn-danger");
  });

  it("applies the glow modifier only when requested", () => {
    const { unmount } = render(<Button>C</Button>);
    expect(screen.getByRole("button").className).not.toContain("btn-glow");
    unmount();
    render(<Button glow>D</Button>);
    expect(screen.getByRole("button").className).toContain("btn-glow");
  });

  it("forwards native button attributes", () => {
    render(
      <Button disabled aria-label="Custom label">
        E
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Custom label" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("MuteButton", () => {
  it("exposes an accessible label reflecting muted state", () => {
    const { unmount } = render(<MuteButton muted={false} onToggle={() => undefined} />);
    expect(screen.getByRole("button", { name: "Mute" })).toBeTruthy();
    unmount();
    render(<MuteButton muted onToggle={() => undefined} />);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
  });

  it("fires onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<MuteButton muted={false} onToggle={onToggle} />);
    screen.getByRole("button").click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("hides its icon from assistive tech", () => {
    const { container } = render(<MuteButton muted={false} onToggle={() => undefined} />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("has a title with the keyboard shortcut", () => {
    render(<MuteButton muted={false} onToggle={() => undefined} />);
    expect(screen.getByRole("button").getAttribute("title")).toContain("(M)");
  });
});

describe("Stat", () => {
  it("renders the label and value", () => {
    render(<Stat label="KILLS" value={12} />);
    expect(screen.getByText("KILLS")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("applies the accent colour when provided", () => {
    render(<Stat label="LEVEL" value={3} accent="#a5f3fc" />);
    const value = screen.getByText("3");
    expect(value.getAttribute("style")).toContain("rgb(165, 243, 252)");
  });

  it("falls back to a light colour when no accent is given", () => {
    render(<Stat label="SCORE" value={5} />);
    expect(screen.getByText("5").getAttribute("style")).toContain("rgb(248, 250, 252)");
  });
});
