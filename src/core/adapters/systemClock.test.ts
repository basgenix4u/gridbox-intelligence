import { describe, expect, it } from "vitest";
import { createManualClock, createSystemClock } from "./systemClock";

describe("createSystemClock", () => {
  it("reports monotonic and wall time as finite numbers", () => {
    const clock = createSystemClock();
    expect(Number.isFinite(clock.now())).toBe(true);
    expect(clock.wallNow()).toBeGreaterThan(1_600_000_000_000);
  });

  it("advances between calls", () => {
    const clock = createSystemClock();
    const before = clock.now();
    const spinUntil = Date.now() + 5;
    while (Date.now() < spinUntil) {
      /* busy-wait a few ms */
    }
    expect(clock.now()).toBeGreaterThanOrEqual(before);
  });
});

describe("createManualClock", () => {
  it("starts at the given value and only moves when told to", () => {
    const clock = createManualClock(1000);
    expect(clock.now()).toBe(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
  });

  it("can be set directly", () => {
    const clock = createManualClock();
    clock.set(42);
    expect(clock.now()).toBe(42);
  });

  it("shares monotonic and wall time", () => {
    const clock = createManualClock(7);
    clock.advance(3);
    expect(clock.wallNow()).toBe(10);
  });
});
