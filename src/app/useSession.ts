/**
 * Session state for the game (task 4.1b).
 *
 * The session is anonymous by design: a JWT identifies the *player*, not a
 * person. There is no password, no email and no PII, which is what makes the
 * whole "just let them play" flow acceptable — see PRD §2.4.
 *
 * The token is persisted so a reload resumes the same player instead of
 * minting a new identity (and orphaning their scores). Storage is injected,
 * so tests never touch localStorage.
 *
 * State machine, deliberately explicit:
 *
 *   idle → creating → ready
 *                 ↘ failed        (retryable: the player can still play)
 *   ready → renaming → ready
 *                  ↘ failed
 *
 * "failed" never blocks play: `player` is `null` and the game runs entirely
 * locally, exactly as it did before the server existed. That is the fallback
 * the whole client is built around.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthResponse, Player, UpdateMeRequest } from "../shared/contracts.js";
import type { KeyValueStore } from "../core/ports/storage.js";
import { createLocalStorageStore } from "../core/adapters/localStorageStore.js";
import {
  TOKEN_KEY,
  createApiClient,
  type ApiError,
  type GameApiClient,
} from "./apiClient.js";

export type SessionStatus = "idle" | "creating" | "ready" | "failed";

export interface SessionState {
  status: SessionStatus;
  player: Player | null;
  error: ApiError | null;
  /** True once a session exists and is usable for authenticated calls. */
  authenticated: boolean;
}

export interface UseSessionDeps {
  client?: GameApiClient;
  store?: KeyValueStore;
  /** Display name to claim on first session. Absent → anonymous. */
  displayName?: string;
}

export interface UseSessionResult extends SessionState {
  /** Creates the session if there is none. Safe to call repeatedly. */
  ensureSession: () => Promise<void>;
  /** Renames the player and re-reads the profile. */
  rename: (body: UpdateMeRequest) => Promise<boolean>;
  /** Drops the local session and starts over. */
  reset: () => void;
  /** Last rename error, kept so the form can show it after the status resets. */
  renameError: ApiError | null;
}

export function useSession(deps: UseSessionDeps = {}): UseSessionResult {
  const client = deps.client ?? createApiClient();
  const store = deps.store ?? createLocalStorageStore();

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [player, setPlayer] = useState<Player | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [renameError, setRenameError] = useState<ApiError | null>(null);

  // Guards against a double-invoked effect (React 18 StrictMode in dev, and
  // any future concurrent render) creating two players for one browser.
  const inFlight = useRef(false);

  const ensureSession = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    if (store.get(TOKEN_KEY)) {
      // A token from an earlier visit: trust it until the server disagrees,
      // then fall back to a fresh anonymous session.
      const me = await client.getMe();
      if (me.ok) {
        setPlayer(me.data);
        setStatus("ready");
        setError(null);
        return;
      }
      if (!me.error.retryable) {
        // 401/404 — the token is dead (rotated secret, deleted player).
        store.remove(TOKEN_KEY);
      }
    }

    inFlight.current = true;
    setStatus("creating");
    try {
      const created = await client.createSession(deps.displayName);
      if (created.ok) {
        setPlayer(created.data.player);
        setStatus("ready");
        setError(null);
      } else {
        setError(created.error);
        setStatus("failed");
      }
    } finally {
      inFlight.current = false;
    }
  }, [client, deps.displayName, store]);

  const rename = useCallback(
    async (body: UpdateMeRequest): Promise<boolean> => {
      const result = await client.updateMe(body);
      if (result.ok) {
        setPlayer(result.data);
        setRenameError(null);
        return true;
      }
      setRenameError(result.error);
      return false;
    },
    [client],
  );

  const reset = useCallback((): void => {
    store.remove(TOKEN_KEY);
    setPlayer(null);
    setError(null);
    setRenameError(null);
    setStatus("idle");
  }, [store]);

  // Create the session on mount. A failure is *not* fatal: the game is fully
  // playable offline, so this never blocks rendering.
  useEffect(() => {
    let live = true;
    // The microtask boundary keeps the synchronous "creating" transition out of
    // the mount effect itself (React rejects a synchronous setState there) and
    // lets StrictMode's double-invoke collapse into a single real attempt.
    void Promise.resolve().then(() => {
      if (live) void ensureSession();
    });
    return () => {
      live = false;
    };
  }, [ensureSession]);

  return {
    status,
    player,
    error,
    renameError,
    authenticated: status === "ready" && player !== null,
    ensureSession,
    rename,
    reset,
  };
}

/** Extracts the initials the server derived, for the compact board rows. */
export function playerInitials(player: AuthResponse["player"] | null): string {
  return player?.initials ?? "???";
}
