// @vitest-environment jsdom

/**
 * backoff (task 4.2).
 *
 * The properties that matter are about *load shape*, not about exact numbers:
 * the delay must grow, must be capped, must be spread out, and must never spin.
 */

import { describe, expect, it, vi } from "vitest";
import {
  BackoffSchedule,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  backoffDelay,
  canRetry,
  resolveDelay,
} from "./backoff.js";

describe("backoffDelay", () => {
  it("doubles with each attempt", () => {
    // jitter 0 so the schedule itself is visible.
    const opts = { jitter: 0 };
    expect(backoffDelay(1, opts)).toBe(BACKOFF_BASE_MS);
    expect(backoffDelay(2, opts)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffDelay(3, opts)).toBe(BACKOFF_BASE_MS * 4);
    expect(backoffDelay(4, opts)).toBe(BACKOFF_BASE_MS * 8);
  });

  it("never exceeds the cap", () => {
    const opts = { jitter: 0 };
    expect(backoffDelay(40, opts)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(400, opts)).toBe(BACKOFF_MAX_MS);
  });

  it("spreads the delay with full jitter", () => {
    // With jitter 1 the delay is uniform in [0, exponential), so sampling many
    // times must produce a range of values, not one repeated number.
    const samples = new Set<number>();
    for (let i = 0; i < 200; i++) samples.add(backoffDelay(5));
    expect(samples.size).toBeGreaterThan(20);
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(BACKOFF_BASE_MS * 2 ** 4);
    }
  });

  it("returns 0 for an attempt before the first retry", () => {
    expect(backoffDelay(0)).toBe(0);
    expect(backoffDelay(-1)).toBe(0);
  });

  it("clamps an infinite attempt to the cap rather than returning 0", () => {
    // Returning 0 here would be a hot retry loop if a caller ever miscounted.
    // Jitter still applies at the cap, so the bound is the window, not a value.
    expect(backoffDelay(Number.POSITIVE_INFINITY, { jitter: 0 })).toBe(BACKOFF_MAX_MS);
    const jittered = backoffDelay(Number.POSITIVE_INFINITY);
    expect(jittered).toBeGreaterThanOrEqual(0);
    expect(jittered).toBeLessThan(BACKOFF_MAX_MS);
  });

  it("treats NaN as no delay rather than propagating it", () => {
    expect(backoffDelay(Number.NaN)).toBe(0);
  });

  it("honours a custom base and cap", () => {
    expect(backoffDelay(1, { baseMs: 1000, jitter: 0 })).toBe(1000);
    expect(backoffDelay(9, { baseMs: 1000, maxMs: 4000, jitter: 0 })).toBe(4000);
  });
});

describe("resolveDelay", () => {
  it("prefers the server's Retry-After over the computed delay", () => {
    // A 429 telling us to wait 5 s is the server managing its own load.
    expect(resolveDelay(1, 5000)).toBe(5000);
    expect(resolveDelay(6, 1234)).toBe(1234);
  });

  it("falls back to the schedule when the server said nothing usable", () => {
    expect(resolveDelay(2, undefined, { jitter: 0 })).toBe(BACKOFF_BASE_MS * 2);
    expect(resolveDelay(2, 0, { jitter: 0 })).toBe(BACKOFF_BASE_MS * 2);
    expect(resolveDelay(2, -1, { jitter: 0 })).toBe(BACKOFF_BASE_MS * 2);
    expect(resolveDelay(2, Number.NaN, { jitter: 0 })).toBe(BACKOFF_BASE_MS * 2);
  });

  it("rounds a fractional Retry-After to whole milliseconds", () => {
    expect(resolveDelay(1, 1500.6)).toBe(1501);
  });
});

describe("canRetry", () => {
  it("retries indefinitely by default", () => {
    expect(canRetry(0)).toBe(true);
    expect(canRetry(1000)).toBe(true);
  });

  it("stops at the configured ceiling", () => {
    expect(canRetry(2, { maxAttempts: 3 })).toBe(true);
    expect(canRetry(3, { maxAttempts: 3 })).toBe(false);
  });
});

describe("BackoffSchedule", () => {
  it("counts failures and grows the delay", () => {
    const schedule = new BackoffSchedule({ jitter: 0 });
    expect(schedule.failures).toBe(0);
    expect(schedule.fail()).toBe(BACKOFF_BASE_MS);
    expect(schedule.fail()).toBe(BACKOFF_BASE_MS * 2);
    expect(schedule.failures).toBe(2);
  });

  it("passes a Retry-After through", () => {
    const schedule = new BackoffSchedule();
    expect(schedule.fail(9000)).toBe(9000);
  });

  it("resets on success, so one good sync clears the history", () => {
    const schedule = new BackoffSchedule({ jitter: 0 });
    schedule.fail();
    schedule.fail();
    expect(schedule.failures).toBe(2);
    schedule.succeed();
    expect(schedule.failures).toBe(0);
    expect(schedule.fail()).toBe(BACKOFF_BASE_MS);
  });

  it("reports exhaustion once the ceiling is reached", () => {
    const schedule = new BackoffSchedule({ maxAttempts: 2, jitter: 0 });
    expect(schedule.exhausted).toBe(false);
    schedule.fail();
    expect(schedule.exhausted).toBe(false);
    schedule.fail();
    expect(schedule.exhausted).toBe(true);
  });

  it("can be reset without a success", () => {
    const schedule = new BackoffSchedule({ jitter: 0 });
    schedule.fail();
    schedule.reset();
    expect(schedule.failures).toBe(0);
  });

  it("is jittered by default, so two schedules do not collide", () => {
    const a = new BackoffSchedule();
    const b = new BackoffSchedule();
    const first = [a.fail(), b.fail()];
    // Not a guarantee for any single pair, but over many attempts the two
    // schedules must not stay locked together.
    const drifted = Array.from({ length: 25 }, () => a.fail() === b.fail()).includes(false);
    expect(first.every((d) => d >= 0 && d < BACKOFF_BASE_MS * 2)).toBe(true);
    expect(drifted).toBe(true);
  });
});

describe("backoff determinism seam", () => {
  it("uses Math.random, so a seeded random makes it reproducible", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      // Half of the exponential window.
      expect(backoffDelay(3)).toBe(Math.round(BACKOFF_BASE_MS * 4 * 0.5));
    } finally {
      random.mockRestore();
    }
  });
});
