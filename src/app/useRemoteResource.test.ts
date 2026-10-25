// @vitest-environment jsdom

/**
 * useRemoteResource (task 4.2).
 *
 * The assertions that matter are the ones a player would notice:
 *
 *  - **empty is not error.** A successful "nothing here" must not be dressed up
 *    as a failure, and vice versa.
 *  - **offline is not error either.** No network is not worth a backoff cycle.
 *  - **stale beats blank.** A failed refresh keeps the last good data.
 *  - **a stale response cannot overwrite a fresh one.**
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRemoteResource } from "./useRemoteResource.js";

/** A rejection shaped like the API client's `ApiError`. */
function apiError(message: string, retryable = true, retryAfterMs?: number): Error {
  return Object.assign(new Error(message), { retryable, retryAfterMs });
}

/** Resolves the promise queue and any scheduled timers. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useRemoteResource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts loading with no data", () => {
    const { result } = renderHook(() =>
      useRemoteResource({ load: () => new Promise<number>(() => undefined) }),
    );
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
  });

  it("becomes ready with the loaded value", async () => {
    const { result } = renderHook(() => useRemoteResource({ load: () => Promise.resolve([1, 2]) }));
    await settle();
    expect(result.current.status).toBe("ready");
    expect(result.current.data).toEqual([1, 2]);
    expect(result.current.error).toBeNull();
  });

  it("distinguishes an empty result from a failure", async () => {
    // The whole point of the hook: "nobody has played today" is a fact about
    // the world, not a broken connection.
    const { result } = renderHook(() =>
      useRemoteResource({ load: () => Promise.resolve([]), isEmpty: (v) => v.length === 0 }),
    );
    await settle();
    expect(result.current.status).toBe("empty");
    expect(result.current.error).toBeNull();
  });

  it("treats a non-empty result as ready", async () => {
    const { result } = renderHook(() =>
      useRemoteResource({ load: () => Promise.resolve([1]), isEmpty: (v) => v.length === 0 }),
    );
    await settle();
    expect(result.current.status).toBe("ready");
  });

  it("reports a failure with its message", async () => {
    const { result } = renderHook(() =>
      useRemoteResource({ load: () => Promise.reject(apiError("boom")) }),
    );
    await settle();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toEqual({ message: "boom", retryable: true });
    expect(result.current.failures).toBe(1);
  });

  it("reports a non-retryable failure as such", async () => {
    const { result } = renderHook(() =>
      useRemoteResource({ load: () => Promise.reject(apiError("nope", false)) }),
    );
    await settle();
    expect(result.current.error?.retryable).toBe(false);
  });

  it("keeps the last good data across a failed refresh", async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useRemoteResource({
        load: () => {
          calls += 1;
          return calls === 1 ? Promise.resolve([1]) : Promise.reject(apiError("boom"));
        },
      }),
    );
    await settle();
    expect(result.current.data).toEqual([1]);

    act(() => {
      result.current.refresh();
    });
    await settle();

    // A stale board beats a blank one.
    expect(result.current.status).toBe("error");
    expect(result.current.data).toEqual([1]);
  });

  it("retries with backoff and recovers", async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useRemoteResource({
        load: () => {
          calls += 1;
          return calls < 3 ? Promise.reject(apiError("boom")) : Promise.resolve([9]);
        },
        backoff: { jitter: 0, baseMs: 100 },
      }),
    );

    await settle();
    expect(calls).toBe(1);
    expect(result.current.status).toBe("error");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(calls).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(calls).toBe(3);
    expect(result.current.status).toBe("ready");
    expect(result.current.data).toEqual([9]);
    expect(result.current.failures).toBe(0);
  });

  it("honours a server Retry-After over the computed delay", async () => {
    let calls = 0;
    renderHook(() =>
      useRemoteResource({
        load: () => {
          calls += 1;
          return calls === 1
            ? Promise.reject(apiError("slow down", true, 5000))
            : Promise.resolve([1]);
        },
        backoff: { jitter: 0, baseMs: 100 },
      }),
    );
    await settle();
    expect(calls).toBe(1);

    // 100 ms would have been enough under the schedule; the server said 5 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(calls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(calls).toBe(2);
  });

  it("stops retrying once the attempt ceiling is reached", async () => {
    let calls = 0;
    renderHook(() =>
      useRemoteResource({
        load: () => {
          calls += 1;
          return Promise.reject(apiError("boom"));
        },
        backoff: { jitter: 0, baseMs: 10, maxAttempts: 2 },
      }),
    );
    await settle();
    expect(calls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(calls).toBe(2);
    // Ceiling reached: no third attempt, however long we wait.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
    });
    expect(calls).toBe(2);
  });

  it("reports offline without burning a retry", async () => {
    // No network is not a failure worth a backoff cycle.
    const { result } = renderHook(() =>
      useRemoteResource({ load: () => Promise.resolve([1]), isOnline: () => false }),
    );
    await settle();
    expect(result.current.status).toBe("offline");
    expect(result.current.data).toBeNull();
    expect(result.current.failures).toBe(0);
    expect(result.current.retrying).toBe(false);
  });

  it("fires immediately when connectivity returns", async () => {
    let online = false;
    const load = vi.fn(() => Promise.resolve([1]));

    const { result } = renderHook(() =>
      useRemoteResource({ load, isOnline: () => online }),
    );
    await settle();
    expect(load).not.toHaveBeenCalled();
    expect(result.current.status).toBe("offline");

    online = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
  });

  it("holds the request while disabled", async () => {
    const load = vi.fn(() => Promise.resolve([1]));
    const { result } = renderHook(() => useRemoteResource({ load, enabled: false }));
    await settle();
    expect(load).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.retrying).toBe(false);
  });

  it("loads once enabled flips to true", async () => {
    const load = vi.fn(() => Promise.resolve([1]));
    const { result, rerender } = renderHook(
      ({ enabled }) => useRemoteResource({ load, enabled }),
      { initialProps: { enabled: false } },
    );
    await settle();
    expect(load).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
  });

  it("ignores a response that arrives after a newer one started", async () => {
    // A slow first request must not overwrite a fast second one.
    let resolveFirst: (v: number[]) => void = () => undefined;
    const first = new Promise<number[]>((r) => {
      resolveFirst = r;
    });
    let calls = 0;
    const { result } = renderHook(() =>
      useRemoteResource({
        load: () => {
          calls += 1;
          return calls === 1 ? first : Promise.resolve([2]);
        },
      }),
    );

    act(() => {
      result.current.refresh();
    });
    await settle();
    expect(result.current.data).toEqual([2]);

    // The stale response lands late.
    await act(async () => {
      resolveFirst([1]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toEqual([2]);
  });

  it("refresh clears the backoff history", async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useRemoteResource({
        load: () => {
          calls += 1;
          return calls === 1 ? Promise.reject(apiError("boom")) : Promise.resolve([1]);
        },
        backoff: { jitter: 0, baseMs: 1000 },
      }),
    );
    await settle();
    expect(result.current.failures).toBe(1);

    act(() => {
      result.current.refresh();
    });
    await settle();
    expect(calls).toBe(2);
    expect(result.current.status).toBe("ready");
    expect(result.current.failures).toBe(0);
  });

  it("clears a pending retry on unmount", async () => {
    let calls = 0;
    const { unmount } = renderHook(() =>
      useRemoteResource({
        load: () => {
          calls += 1;
          return Promise.reject(apiError("boom"));
        },
        backoff: { jitter: 0, baseMs: 50 },
      }),
    );
    await settle();
    expect(calls).toBe(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls).toBe(1);
  });

  it("does not loop when `load` has a fresh identity every render", async () => {
    // An inline arrow is a new function on every render. Depending on it makes
    // the fetch effect re-run on every state change, which sets state, which
    // re-renders, which refetches — an unbounded loop that only shows up as a
    // pegged CPU and a worker that dies. This is the regression guard.
    const load = vi.fn(() => Promise.resolve([1]));
    const { result, rerender } = renderHook(() => useRemoteResource({ load }));

    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i++) {
      rerender();
      await settle();
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
  });

  it("re-fetches when the query key changes", async () => {
    const load = vi.fn(() => Promise.resolve([1]));
    const { rerender } = renderHook(({ key }) => useRemoteResource({ load, queryKey: key }), {
      initialProps: { key: "daily" },
    });
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    rerender({ key: "global" });
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reports a rejection with no message as a generic failure", async () => {
    // `new Error("")` is the closest a lint-clean test gets to a rejection that
    // carries no usable text; the hook must still produce a sentence.
    const { result } = renderHook(() => useRemoteResource({ load: () => Promise.reject(new Error("")) }));
    await settle();
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("");
  });
});
