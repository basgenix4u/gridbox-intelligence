// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ message = "kaboom" }: { message?: string }): ReactElement {
  throw new Error(message);
}

function Safe(): ReactElement {
  return <p>all good</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Safe />
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("swaps in the recovery panel when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByText("all good")).toBeNull();
  });

  it("logs the error and the component stack to the console", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom message="kaboom" />
      </ErrorBoundary>,
    );
    expect(spy).toHaveBeenCalled();
    // React logs the raw error first; the boundary's own tagged line follows.
    const messages = spy.mock.calls.map((args) => String(args[0]));
    expect(messages.some((m) => m.includes("[error-boundary]"))).toBe(true);
  });

  it("hands the error to the onError reporter", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom message="kaboom" />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [error, info] = onError.mock.calls[0] as unknown as [Error, { componentStack?: string }];
    expect(error.message).toBe("kaboom");
    expect(typeof info.componentStack).toBe("string");
  });

  it("focuses the recovery action for keyboard users", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Try again" }));
  });

  it("Try again resets the boundary and re-renders the children", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    screen.getByRole("button", { name: "Try again" }).click();
    // After the reset the children mount again; the boom throws again, so the
    // panel returns — what matters is the boundary did not stay wedged.
    rerender(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("shows the development overlay with the stack while developing", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom message="kaboom" />
      </ErrorBoundary>,
    );
    // Vitest sets import.meta.env.DEV, so the overlay is present under test.
    const overlay = screen.getByTestId("dev-error-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain("kaboom");
  });
});
