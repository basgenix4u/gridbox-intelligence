/**
 * Async resource state (task 4.2).
 *
 * Every server read in this app has the same four visible states, and getting
 * them wrong is the difference between a game that feels broken and one that
 * feels slow:
 *
 *   loading  first attempt in flight, nothing to show yet
 *   ready    data in hand
 *   empty    the request succeeded and the answer was "nothing here"
 *   error    the request failed — and `offline` when we know why
 *
 * The distinction that matters most is **empty vs error**. An empty leaderboard
 * is a fact about the world ("nobody has played today yet") and deserves an
 * invitation; an error is a fact about the connection and deserves a retry.
 * Collapsing them into one "no data" state is how a UI ends up telling a player
 * with a perfect connection that the leaderboard is empty.
 *
 * `offline` is separated from `error` because it is *not* a failure worth
 * retrying on a timer — the browser already knows there is no network, so
 * waiting out a backoff is theatre. The request is held until connectivity
 * returns, then issued immediately.
 *
 * Retry is exponential with jitter (see `backoff.ts`), and the last good data
 * is kept across a failed refresh so a stale board beats a blank one.
 *
 * `load` is read through a ref rather than listed as an effect dependency. An
 * inline arrow has a fresh identity on every render, so depending on it makes
 * the fetch effect re-run on every state change — which sets state, which
 * re-renders, which refetches. Callers signal "this is a different request"
 * with `queryKey` instead.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { BackoffSchedule, type BackoffOptions } from "./backoff.js";

export type ResourceStatus = "loading" | "ready" | "empty" | "error" | "offline";

export interface ResourceState<T> {
  status: ResourceStatus;
  data: T | null;
  /** Present on `error`. Retryable errors may resolve on their own. */
  error: { message: string; retryable: boolean } | null;
  /** Failures since the last success. 0 when healthy. */
  failures: number;
  /** A retry is scheduled or in flight. */
  retrying: boolean;
}

export interface UseRemoteResourceDeps<T> {
  /** Performs the request. Must resolve to a value or reject. */
  load: () => Promise<T>;
  /**
   * True when the value means "nothing here" rather than "here is nothing".
   * Read through a ref like `load`, so an inline arrow is safe.
   */
  isEmpty?: (value: T) => boolean;
  /** Skips the request entirely (e.g. no session yet). */
  enabled?: boolean;
  /** Browser connectivity, so `offline` can be told apart from `error`. */
  isOnline?: () => boolean;
  /**
   * Change this to re-fetch. Anything that makes the request different — a
   * different board, a different mode, a different day — belongs here.
   */
  queryKey?: string;
  backoff?: BackoffOptions;
}

export interface UseRemoteResourceResult<T> extends ResourceState<T> {
  /** Re-runs the request now, clearing the backoff history. */
  refresh: () => void;
}

const INITIAL: ResourceState<never> = {
  status: "loading",
  data: null,
  error: null,
  failures: 0,
  retrying: false,
};

export function useRemoteResource<T>(deps: UseRemoteResourceDeps<T>): UseRemoteResourceResult<T> {
  const { enabled = true, queryKey } = deps;

  // Everything the request needs, read at call time. Kept in a ref so the
  // fetch effect can be stable without forcing callers to memoise. Written in
  // an effect, not during render: a render can be discarded, and a ref write
  // that survives it is exactly the bug the rule is guarding against.
  const latest = useRef(deps);

  const [state, setState] = useState<ResourceState<T>>(INITIAL as ResourceState<T>);
  // The schedule lives outside state: it is a counter, not something to render.
  const schedule = useRef(new BackoffSchedule(deps.backoff));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinguishes "the request I started is still the current one" from a
  // stale response arriving after the component moved on.
  const generation = useRef(0);
  // Lets the retry timer call the current `run` without `run` having to name
  // itself inside its own callback.
  const runRef = useRef<(() => Promise<void>) | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const run = useCallback(async (): Promise<void> => {
    const { load, isEmpty, isOnline } = latest.current;

    // Offline is not a failure: hold the request until the network is back
    // rather than burning a backoff cycle on it.
    if (isOnline && !isOnline()) {
      setState((s) => ({ ...s, status: "offline", retrying: false }));
      return;
    }

    const mine = ++generation.current;
    // `retrying` is true while anything is in flight, including a background
    // refresh that already has data to show.
    setState((s) => ({ ...s, retrying: true }));

    try {
      const value = await load();
      if (mine !== generation.current) return; // superseded
      schedule.current.succeed();
      setState({
        status: isEmpty?.(value) ? "empty" : "ready",
        data: value,
        error: null,
        failures: 0,
        retrying: false,
      });
    } catch (err) {
      if (mine !== generation.current) return; // superseded
      const message = err instanceof Error ? err.message : "request failed";
      const retryable = (err as { retryable?: boolean }).retryable !== false;
      const delay = schedule.current.fail((err as { retryAfterMs?: number }).retryAfterMs);

      // The last good data is kept: a stale board beats a blank one.
      setState((s) => ({
        ...s,
        status: "error",
        error: { message, retryable },
        failures: schedule.current.failures,
        retrying: false,
      }));

      if (schedule.current.exhausted) return;
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        void runRef.current?.();
      }, delay);
    }
  }, [clearTimer]);

  // Declared before the fetch effect so it runs first: the request must see
  // the deps from *this* render, not the previous one.
  useEffect(() => {
    latest.current = deps;
    runRef.current = run;
  });

  const refresh = useCallback(() => {
    schedule.current.reset();
    clearTimer();
    void run();
  }, [run, clearTimer]);

  // Fetch on mount, when enabled flips, and when the query changes. `run` is
  // stable, so an inline `load` cannot cause a loop. Disabling simply skips
  // the request — every state transition happens inside `run`, never here.
  useEffect(() => {
    if (!enabled) return;
    void run();
    return clearTimer;
  }, [enabled, queryKey, run, clearTimer]);

  // Coming back online is the one event worth an immediate request: the
  // backoff was waiting for exactly this.
  useEffect(() => {
    if (!latest.current.isOnline) return;
    const onOnline = () => {
      clearTimer();
      void run();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [run, clearTimer]);

  return { ...state, refresh };
}
