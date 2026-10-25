/**
 * Exponential backoff with jitter (task 4.2).
 *
 * Retrying a leaderboard sync at a fixed interval is how a transient outage
 * turns into a self-inflicted DDoS: every client that lost the connection comes
 * back at the same moment, and the server — which is already struggling — gets
 * hit again in lockstep. Two things fix that, and both live here:
 *
 *  1. **Exponential growth**, so a long outage costs a handful of requests
 *     rather than one per second per client.
 *  2. **Jitter**, so those handfuls are spread out instead of colliding.
 *
 * `retryAfterMs` from the API client wins over the computed delay when the
 * server has told us how long it wants us to wait — a 429 with a `Retry-After`
 * header is the server managing its own load, and ignoring it would be rude.
 *
 * Pure functions, no timers: the caller owns `setTimeout`, which is what makes
 * this testable without fake clocks and safe to call from a React effect.
 */

/** Default schedule. Doubling from 500 ms, capped at 30 s. */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 30_000;
/** Never give up automatically: the player can retry by hand at any time. */
export const BACKOFF_MAX_ATTEMPTS = Number.POSITIVE_INFINITY;

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 0 = none, 1 = full jitter (the delay is uniform in [0, computed]). */
  jitter?: number;
  maxAttempts?: number;
}

/**
 * The delay before attempt `attempt` (1-based: 1 is the *first retry*).
 *
 * Full jitter (`jitter: 1`) is the default because it is the variant that
 * actually spreads load — "equal jitter" still clusters clients into a few
 * buckets, which is the problem we are trying to avoid.
 */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? BACKOFF_BASE_MS;
  const max = options.maxMs ?? BACKOFF_MAX_MS;
  const jitter = options.jitter ?? 1;

  // Below the first retry, or not a number at all: no wait. `Infinity` is
  // deliberately *not* in that group — clamping it to the cap is safe, while
  // returning 0 would be a hot retry loop if a caller ever miscounted.
  if (Number.isNaN(attempt) || attempt < 1) return 0;

  const exponential = Math.min(max, base * 2 ** (attempt - 1));
  if (jitter <= 0) return exponential;
  // Full jitter: uniform in [0, exponential). Keeps the *expected* delay at
  // half the exponential value, which is the standard trade.
  const spread = exponential * Math.min(1, jitter);
  return Math.round(Math.random() * spread);
}

/**
 * The delay to actually wait, preferring the server's own instruction.
 * Returns 0 when the server said "now" or gave a value we cannot use.
 */
export function resolveDelay(
  attempt: number,
  retryAfterMs: number | undefined,
  options: BackoffOptions = {},
): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.round(retryAfterMs);
  }
  return backoffDelay(attempt, options);
}

/** Whether another automatic attempt is allowed after `attempts` failures. */
export function canRetry(attempts: number, options: BackoffOptions = {}): boolean {
  const max = options.maxAttempts ?? BACKOFF_MAX_ATTEMPTS;
  return attempts < max;
}

/**
 * A tiny stateful schedule, so callers do not each re-implement "count the
 * failures, compute the next delay, reset on success".
 */
export class BackoffSchedule {
  private attempts = 0;
  private readonly options: BackoffOptions;

  constructor(options: BackoffOptions = {}) {
    this.options = options;
  }

  /** Failures so far. */
  get failures(): number {
    return this.attempts;
  }

  /** Whether the last failure should be retried automatically. */
  get exhausted(): boolean {
    return !canRetry(this.attempts, this.options);
  }

  /** Records a failure and returns the delay before the next attempt. */
  fail(retryAfterMs?: number): number {
    this.attempts += 1;
    return resolveDelay(this.attempts, retryAfterMs, this.options);
  }

  /** Records a success. */
  succeed(): void {
    this.attempts = 0;
  }

  /** Forgets the history without waiting for a success. */
  reset(): void {
    this.attempts = 0;
  }
}
