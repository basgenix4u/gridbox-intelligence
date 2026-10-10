import { describe, expect, it } from "vitest";
import { formatDate, formatTime } from "./format";

describe("formatTime", () => {
  it("formats seconds under a minute", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9_000)).toBe("0:09");
    expect(formatTime(59_000)).toBe("0:59");
  });

  it("formats minutes and zero-pads seconds", () => {
    expect(formatTime(60_000)).toBe("1:00");
    expect(formatTime(92_000)).toBe("1:32");
    expect(formatTime(605_000)).toBe("10:05");
  });

  it("truncates rather than rounding up", () => {
    expect(formatTime(61_999)).toBe("1:01");
  });
});

describe("formatDate", () => {
  it("renders a short month and day", () => {
    // Fixed timestamp avoids timezone-dependent flake on the day boundary.
    const formatted = formatDate(Date.UTC(2026, 9, 9, 12));
    expect(formatted).toMatch(/Oct/);
    expect(formatted).toMatch(/\b9\b|\b10\b/);
  });

  it("is stable for the same input", () => {
    const ts = Date.UTC(2026, 0, 15, 12);
    expect(formatDate(ts)).toBe(formatDate(ts));
  });
});
