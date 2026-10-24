// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StallNotice } from "./StallNotice";

describe("StallNotice", () => {
  it("announces itself as an alert", () => {
    render(<StallNotice onResume={() => undefined} onMenu={() => undefined} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("offers resume and menu actions", () => {
    const onResume = vi.fn();
    const onMenu = vi.fn();
    render(<StallNotice onResume={onResume} onMenu={onMenu} />);
    screen.getByRole("button", { name: "Resume" }).click();
    screen.getByRole("button", { name: "Main menu" }).click();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("focuses the resume button on mount", () => {
    render(<StallNotice onResume={() => undefined} onMenu={() => undefined} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Resume" }));
  });
});
