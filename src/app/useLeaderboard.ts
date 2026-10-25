/**
 * Leaderboard sync (task 4.2, the consumer that proves the state machine).
 *
 * The board is the one read in this app that is *allowed* to fail: it is
 * decoration around a game that works perfectly without it. So the states are
 * deliberately separated rather than collapsed into "no data":
 *
 *   ready    rows in hand — show them
 *   empty    the server said "nobody has played this yet" — an invitation, not
 *            an apology
 *   offline  there is no network — say so, and stop asking until it returns
 *   error    the server is unhappy — retry on a backoff, keep the last board
 *   loading  first attempt, nothing to show yet
 *
 * `daily` and `global` are one hook rather than two because the only thing that
 * changes is the endpoint and the `queryKey`; two hooks would be two copies of
 * the same state machine.
 */

import { useCallback, useMemo } from "react";
import type { ApiError } from "./apiClient.js";
import type { LeaderboardRow, RunMode } from "../shared/contracts.js";
import type { GameApiClient } from "./apiClient.js";
import {
  useRemoteResource,
  type ResourceState,
  type UseRemoteResourceResult,
} from "./useRemoteResource.js";

export type BoardScope = "daily" | "global";

export interface UseLeaderboardDeps {
  client: GameApiClient;
  scope: BoardScope;
  mode: RunMode;
  /** Skips the request until a session exists. */
  enabled?: boolean;
  isOnline?: () => boolean;
  /** Today's key for the daily scope (YYYY-MM-DD). Injected so tests are stable. */
  day?: string;
}

export type LeaderboardState = ResourceState<LeaderboardRow[]>;

export interface UseLeaderboardResult extends UseRemoteResourceResult<LeaderboardRow[]> {
  /** The scope this board was fetched for, for the UI to label itself. */
  scope: BoardScope;
  mode: RunMode;
  day: string | null;
  /** Convenience for the common "is there anything to render" question. */
  hasRows: boolean;
}

/**
 * Re-throws an `ApiError` as a real `Error` carrying the same metadata.
 *
 * The API client's failures are plain discriminated objects, not `Error`
 * instances, because they are *returned* rather than thrown. `useRemoteResource`
 * needs an actual rejection, and it reads `retryable` / `retryAfterMs` off what
 * it catches — so the metadata has to travel with the Error, not be dropped.
 */
function toThrowable(error: ApiError): Error {
  const err = new Error(error.message);
  return Object.assign(err, {
    code: error.code,
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs,
    status: error.status,
    requestId: error.requestId,
  });
}

/** Today in the player's own timezone — the daily board is a *local* day. */
export function localDay(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function useLeaderboard(deps: UseLeaderboardDeps): UseLeaderboardResult {
  const { client, scope, mode, enabled = true, isOnline, day } = deps;
  const resolvedDay = day ?? localDay();

  // A new function per render is fine: `useRemoteResource` reads it through a
  // ref and re-fetches on `queryKey`, not on identity.
  const load = useCallback(async (): Promise<LeaderboardRow[]> => {
    const result =
      scope === "daily"
        ? await client.dailyBoard(mode, 50, resolvedDay)
        : await client.globalBoard(mode, 50);
    // The client never throws, so a failure arrives as `ok: false` and has to
    // be turned back into a rejection for the resource hook to see it.
    if (!result.ok) throw toThrowable(result.error);
    return result.data.rows;
  }, [client, scope, mode, resolvedDay]);

  const resource = useRemoteResource<LeaderboardRow[]>({
    load,
    isEmpty: (rows) => rows.length === 0,
    enabled,
    isOnline,
    queryKey: `${scope}:${mode}:${resolvedDay}`,
  });

  const hasRows = useMemo(() => (resource.data?.length ?? 0) > 0, [resource.data]);

  return {
    ...resource,
    scope,
    mode,
    day: scope === "daily" ? resolvedDay : null,
    hasRows,
  };
}
