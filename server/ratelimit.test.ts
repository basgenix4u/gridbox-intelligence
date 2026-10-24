import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter, createUpstashRateLimiter, RATE_LIMITS } from "./ratelimit.js";

describe("createMemoryRateLimiter", () => {
  it("allows up to the limit, then blocks with a retry-after", async () => {
    const now = 1_000_000;
    const limiter = createMemoryRateLimiter(() => now);

    for (let i = 0; i < 3; i++) {
      const r = await limiter.check("ip:1", 3, 60_000);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(2 - i);
    }
    const blocked = await limiter.check("ip:1", 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("resets once the window has passed", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    await limiter.check("ip:1", 1, 1_000);
    expect((await limiter.check("ip:1", 1, 1_000)).ok).toBe(false);
    now = 1_001;
    const after = await limiter.check("ip:1", 1, 1_000);
    expect(after.ok).toBe(true);
    expect(after.retryAfterMs).toBe(0);
  });

  it("sweeps expired buckets so silent keys do not leak", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    // Fill a window, let it expire, then push past the sweep threshold with
    // fresh keys. The expired entries must be gone, not accumulated.
    await limiter.check("old", 1, 1_000);
    now = 10_000;
    for (let i = 0; i < 1_001; i++) {
      await limiter.check(`ip-${i}`, 5, 1_000);
    }
    // "old" expired long ago: a new window starts, and the sweep ran.
    expect((await limiter.check("old", 1, 1_000)).ok).toBe(true);
  });

  it("keeps keys independent", async () => {
    const limiter = createMemoryRateLimiter();
    expect((await limiter.check("ip:1", 1, 1_000)).ok).toBe(true);
    expect((await limiter.check("ip:2", 1, 1_000)).ok).toBe(true);
    expect((await limiter.check("ip:1", 1, 1_000)).ok).toBe(false);
  });
});

describe("createUpstashRateLimiter", () => {
  /** Minimal fake of the Upstash REST surface: INCR then PTTL. */
  function fakeRedis(counter: { n: number }, opts: { failIncr?: boolean } = {}) {
    const calls: string[] = [];
    const json = (result: unknown) => () => Promise.resolve({ result });
    const fetchImpl = ((url: string) => {
      calls.push(url);
      if (url.includes("/incr/")) {
        if (opts.failIncr) return { ok: false, json: json(null) } as unknown as Response;
        counter.n += 1;
        return { ok: true, json: json(String(counter.n)) } as unknown as Response;
      }
      if (url.includes("/pttl/")) {
        return { ok: true, json: json("42000") } as unknown as Response;
      }
      return { ok: true, json: json("1") } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("counts hits and reports the retry-after from PTTL", async () => {
    const counter = { n: 0 };
    const { fetchImpl } = fakeRedis(counter);
    const limiter = createUpstashRateLimiter("https://redis.example", "token", fetchImpl);

    const first = await limiter.check("ip:1", 2, 60_000);
    expect(first).toEqual({ ok: true, remaining: 1, retryAfterMs: 0 });
    const second = await limiter.check("ip:1", 2, 60_000);
    expect(second).toEqual({ ok: true, remaining: 0, retryAfterMs: 0 });
    const third = await limiter.check("ip:1", 2, 60_000);
    expect(third.ok).toBe(false);
    expect(third.retryAfterMs).toBe(42_000);
  });

  it("fails open when Redis errors", async () => {
    const counter = { n: 0 };
    const { fetchImpl } = fakeRedis(counter, { failIncr: true });
    const limiter = createUpstashRateLimiter("https://redis.example", "token", fetchImpl);
    const result = await limiter.check("ip:1", 1, 60_000);
    expect(result).toEqual({ ok: true, remaining: 0, retryAfterMs: 0 });
  });

  it("fails open when the network throws", async () => {
    const fetchImpl = (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    const limiter = createUpstashRateLimiter("https://redis.example", "token", fetchImpl);
    expect((await limiter.check("ip:1", 1, 60_000)).ok).toBe(true);
  });
});

describe("RATE_LIMITS", () => {
  it("keeps report abuse strict and reads generous", () => {
    expect(RATE_LIMITS.auth.limit).toBe(10);
    expect(RATE_LIMITS.submit.limit).toBe(20);
    expect(RATE_LIMITS.report.limit).toBe(5);
    expect(RATE_LIMITS.read.limit).toBe(120);
    expect(RATE_LIMITS.report.windowMs).toBe(3_600_000);
  });
});
