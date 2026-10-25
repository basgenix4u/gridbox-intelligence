// @vitest-environment jsdom

/**
 * useLeaderboard (task 4.2).
 *
 * The board is decoration around a game that works without it, so the whole
 * point of this hook is that failure is *legible*: the UI must be able to tell
 * "the server is unhappy" from "nobody has played today" from "you are
 * offline". Those three sentences are what these tests pin.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardResponse, LeaderboardRow, RunMode } from "../shared/contracts.js";
import type { GameApiClient } from "./apiClient.js";
import { localDay, useLeaderboard } from "./useLeaderboard.js";

const ROW: LeaderboardRow = {
  rank: 1,
  playerId: "11111111-1111-4111-8111-111111111111",
  initials: "LEV",
  score: 900,
  level: 10,
  isYou: false,
};

function board(rows: LeaderboardRow[], scope: "global" | "daily" = "global"): LeaderboardResponse {
  return { scope, mode: "endless", day: scope === "daily" ? "2026-10-25" : null, rows };
}

/** What a scripted board method resolves to. */
type BoardResult =
  | { ok: true; data: LeaderboardResponse }
  | { ok: false; error: ReturnType<typeof apiError> };

/**
 * A client stub whose two board methods can be scripted independently. The
 * handlers return a promise rather than being `async`: they are scripted, not
 * awaited, and an `async` keyword would only trip `require-await`.
 */
function clientStub(handlers: { global?: () => BoardResult; daily?: () => BoardResult }) {
  return {
    globalBoard: handlers.global ?? ((): BoardResult => ({ ok: true, data: board([]) })),
    dailyBoard:
      handlers.daily ?? ((): BoardResult => ({ ok: true, data: board([], "daily") })),
  } as unknown as GameApiClient;
}

function apiError(message: string, retryable = true, retryAfterMs?: number) {
  return Object.assign(new Error(message), { code: "SERVER", retryable, retryAfterMs });
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useLeaderboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads the global board", async () => {
    const client = clientStub({
      global: (): BoardResult => ({ ok: true, data: board([ROW]) }),
    });
    const { result } = renderHook(() => useLeaderboard({ client, scope: "global", mode: "endless" }));
    await settle();

    expect(result.current.status).toBe("ready");
    expect(result.current.data).toEqual([ROW]);
    expect(result.current.hasRows).toBe(true);
    expect(result.current.day).toBeNull();
  });

  it("loads the daily board for the injected day", async () => {
    const daily = vi.fn((): BoardResult => ({ ok: true, data: board([ROW], "daily") }));
    const client = clientStub({ daily });
    const { result } = renderHook(() =>
      useLeaderboard({ client, scope: "daily", mode: "endless", day: "2026-10-25" }),
    );
    await settle();

    expect(daily).toHaveBeenCalledWith("endless", 50, "2026-10-25");
    expect(result.current.day).toBe("2026-10-25");
    expect(result.current.data).toEqual([ROW]);
  });

  it("reports an empty board as empty, not as an error", async () => {
    const client = clientStub({ global: (): BoardResult => ({ ok: true, data: board([]) }) });
    const { result } = renderHook(() => useLeaderboard({ client, scope: "global", mode: "endless" }));
    await settle();

    expect(result.current.status).toBe("empty");
    expect(result.current.error).toBeNull();
    expect(result.current.hasRows).toBe(false);
  });

  it("turns a failed result into an error the UI can retry", async () => {
    const client = clientStub({
      global: (): BoardResult => ({ ok: false, error: apiError("board unavailable") }),
    });
    const { result } = renderHook(() => useLeaderboard({ client, scope: "global", mode: "endless" }));
    await settle();

    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("board unavailable");
    expect(result.current.error?.retryable).toBe(true);
  });

  it("retries a failed board on a backoff and recovers", async () => {
    let calls = 0;
    const client = clientStub({
      global: (): BoardResult => {
        calls += 1;
        return calls < 2
          ? { ok: false, error: apiError("boom") }
          : { ok: true, data: board([ROW]) };
      },
    });
    // jitter 0 so the retry lands at a known 500 ms rather than somewhere in
    // [0, 500). The default full jitter is right for production — it is what
    // stops every client retrying in lockstep — but a test that samples it is
    // a test that can flake.
    const { result } = renderHook(() =>
      useLeaderboard({
        client,
        scope: "global",
        mode: "endless",
        backoff: { jitter: 0, baseMs: 500 },
      }),
    );
    await settle();
    expect(result.current.status).toBe("error");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(result.current.status).toBe("error");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.data).toEqual([ROW]);
  });

  it("reports offline without asking the server", async () => {
    const global = vi.fn((): BoardResult => ({ ok: true, data: board([ROW]) }));
    const client = clientStub({ global });
    const { result } = renderHook(() =>
      useLeaderboard({ client, scope: "global", mode: "endless", isOnline: () => false }),
    );
    await settle();

    expect(global).not.toHaveBeenCalled();
    expect(result.current.status).toBe("offline");
  });

  it("holds the request until a session exists", async () => {
    const global = vi.fn((): BoardResult => ({ ok: true, data: board([ROW]) }));
    const client = clientStub({ global });
    const { result } = renderHook(() =>
      useLeaderboard({ client, scope: "global", mode: "endless", enabled: false }),
    );
    await settle();

    expect(global).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the scope changes", async () => {
    const global = vi.fn((): BoardResult => ({ ok: true, data: board([ROW]) }));
    const daily = vi.fn((): BoardResult => ({ ok: true, data: board([ROW], "daily") }));
    const client = clientStub({ global, daily });

    const { rerender } = renderHook(
      ({ scope }: { scope: "global" | "daily" }) =>
        useLeaderboard({ client, scope, mode: "endless", day: "2026-10-25" }),
      { initialProps: { scope: "global" as "global" | "daily" } },
    );
    await settle();
    expect(global).toHaveBeenCalledTimes(1);
    expect(daily).not.toHaveBeenCalled();

    rerender({ scope: "daily" });
    await settle();
    expect(daily).toHaveBeenCalledTimes(1);
    expect(global).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when the mode changes", async () => {
    const global = vi.fn((): BoardResult => ({ ok: true, data: board([ROW]) }));
    const client = clientStub({ global });
    const { rerender } = renderHook(
      ({ mode }) => useLeaderboard({ client, scope: "global", mode }),
      { initialProps: { mode: "endless" as RunMode } },
    );
    await settle();
    rerender({ mode: "zen" });
    await settle();
    expect(global).toHaveBeenCalledTimes(2);
  });
});

describe("localDay", () => {
  it("formats a date as YYYY-MM-DD in local time", () => {
    // A UTC formatter would roll the day back for anyone west of Greenwich,
    // which would hand them yesterday's board.
    expect(localDay(new Date(2026, 9, 25, 23, 59))).toBe("2026-10-25");
    expect(localDay(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
    expect(localDay(new Date(2026, 11, 31, 12, 0))).toBe("2026-12-31");
  });

  it("zero-pads single-digit months and days", () => {
    expect(localDay(new Date(2026, 2, 5))).toBe("2026-03-05");
  });
});
