/**
 * Rate limiting (task 3.10).
 *
 * One small interface, two adapters: an in-memory counter (development, and a
 * best-effort floor in production) and Upstash Redis over its REST API
 * (global across serverless invocations — the only correct answer once the API
 * runs on more than one lambda).
 *
 * The limiter fails *open* on backend errors: an Upstash outage must not take
 * the game down. Limits are enforced per key (IP or player id) per route.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Milliseconds until the window resets; 0 when allowed. */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Per-instance fixed-window counter. Best-effort across lambdas. */
export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, Bucket>();
  return {
    check(key, limit, windowMs): Promise<RateLimitResult> {
      const t = now();
      const bucket = buckets.get(key);
      if (!bucket || t >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: t + windowMs });
        return Promise.resolve({ ok: true, remaining: limit - 1, retryAfterMs: 0 });
      }
      bucket.count += 1;
      if (bucket.count > limit) {
        return Promise.resolve({ ok: false, remaining: 0, retryAfterMs: Math.max(0, bucket.resetAt - t) });
      }
      return Promise.resolve({ ok: true, remaining: Math.max(0, limit - bucket.count), retryAfterMs: 0 });
    },
  };
}

/**
 * Upstash Redis fixed-window counter over REST. Uses INCR for the count and
 * PTTL for the reset time; the first hit of a window arms the TTL.
 */
export function createUpstashRateLimiter(url: string, token: string, fetchImpl: typeof fetch = fetch): RateLimiter {
  const base = url.replace(/\/$/, "");
  const call = async (path: string): Promise<string | null> => {
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: unknown };
      const result = body.result;
      return typeof result === "string" || typeof result === "number" ? String(result) : null;
    } catch {
      return null;
    }
  };

  return {
    async check(key, limit, windowMs) {
      const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
      const count = await call(`/incr/gridbox:rl:${encodeURIComponent(key)}`);
      if (count === null) return { ok: true, remaining: limit - 1, retryAfterMs: 0 }; // fail open
      const n = Number(count);
      if (!Number.isFinite(n)) return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
      if (n === 1) {
        await call(`/expire/gridbox:rl:${encodeURIComponent(key)}/${windowSeconds}`);
      }
      if (n > limit) {
        const pttl = await call(`/pttl/gridbox:rl:${encodeURIComponent(key)}`);
        const ms = pttl !== null && Number.isFinite(Number(pttl)) && Number(pttl) > 0 ? Number(pttl) : windowMs;
        return { ok: false, remaining: 0, retryAfterMs: ms };
      }
      return { ok: true, remaining: Math.max(0, limit - n), retryAfterMs: 0 };
    },
  };
}

/** Per-route limits, applied by key prefix. */
export const RATE_LIMITS = {
  /** Anonymous session creation, per IP. */
  auth: { limit: 10, windowMs: 60_000 },
  /** Run submission, per player. */
  submit: { limit: 20, windowMs: 60_000 },
  /** Name reports, per player — strict: reports are an abuse vector. */
  report: { limit: 5, windowMs: 3_600_000 },
  /** Board reads, per IP. */
  read: { limit: 120, windowMs: 60_000 },
} as const;
