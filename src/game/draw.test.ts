import { describe, expect, it } from "vitest";
import { clamp, easeOutBack, easeOutCubic, hexToRgb, rgba } from "./draw";

describe("clamp", () => {
  it("bounds a value on both sides", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("is inclusive at the edges", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("easeOutCubic", () => {
  it("is anchored at 0 and 1", () => {
    expect(easeOutCubic(0)).toBeCloseTo(0, 6);
    expect(easeOutCubic(1)).toBeCloseTo(1, 6);
  });

  it("decelerates: faster than linear in the first half", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("easeOutBack", () => {
  it("is anchored at 0 and 1", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 6);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
  });

  it("overshoots past 1 before settling", () => {
    const samples = Array.from({ length: 99 }, (_, i) => easeOutBack((i + 1) / 100));
    expect(Math.max(...samples)).toBeGreaterThan(1);
  });
});

describe("hexToRgb", () => {
  it("parses a six-digit hex colour", () => {
    expect(hexToRgb("#22d3ee")).toEqual({ r: 34, g: 211, b: 238 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("accepts the form with or without a leading hash", () => {
    expect(hexToRgb("22d3ee")).toEqual(hexToRgb("#22d3ee"));
  });

  it("throws on malformed input rather than silently mis-rendering", () => {
    expect(() => hexToRgb("#zzz")).toThrow(/invalid hex colour/);
    expect(() => hexToRgb("#12345")).toThrow(/invalid hex colour/);
    expect(() => hexToRgb("")).toThrow(/invalid hex colour/);
  });
});

describe("rgba", () => {
  it("converts a hex colour to an rgba() string", () => {
    expect(rgba("#da4167", 0.5)).toBe("rgba(218,65,103,0.5)");
    expect(rgba("#000000", 1)).toBe("rgba(0,0,0,1)");
  });
});
