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
import { readToken, TOKEN_KEY, createApiClient, type ApiError, type GameApiClient } from "./apiClient.js";
import {
  useLegacyMigration,
  type MigrationState,
} from "./useLegacyMigration.js";

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
  /** Injected so the migration upload never touches the network in tests. */
  fetchImpl?: typeof fetch;
  /** API origin; relative in the browser, absolute in tests. */
  baseUrl?: string;
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
  /**
   * Legacy-migration state, driven by a successful rename. Read-only for the
   * UI: `done` with an outcome it can show, `running` while the upload is in
   * flight. Never blocks the rename.
   */
  migration: MigrationState;
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

  // Task 3.13's call site. The token is a getter: the client writes it to
  // storage, so reading it at call time is the only way to see the current
  // value rather than whatever existed when this render started. Memoised so
  // `runMigration` (and therefore `rename`) keeps a stable identity.
  const readTokenNow = useCallback(() => readToken(store), [store]);
  const migration = useLegacyMigration({
    token: readTokenNow,
    store,
    fetchImpl: deps.fetchImpl,
    baseUrl: deps.baseUrl,
  });
  const runMigration = migration.runMigration;

  /**
   * The body of `ensureSession`, split out so the outer wrapper can promise
   * that *nothing* escapes — not even a client that throws instead of
   * returning a failed ApiResult.
   */
  const ensureSessionInner = useCallback(async (): Promise<void> => {
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
      if (me.error.retryable) {
        // A 503 or a timeout says nothing about the token — only about the
        // server, which will be back. Minting a new session here would orphan
        // every score this player has, so we keep the token and report the
        // failure. `ensureSession` is safe to call again once the server is.
        setError(me.error);
        setStatus("failed");
        return;
      }
      // 401/404 — the token is dead (rotated secret, deleted player) and
      // there is nothing left to preserve. Start over anonymously.
      store.remove(TOKEN_KEY);
    }

    setStatus("creating");
    const created = await client.createSession(deps.displayName);
    if (created.ok) {
      setPlayer(created.data.player);
      setStatus("ready");
      setError(null);
    } else {
      setError(created.error);
      setStatus("failed");
    }
  }, [client, deps.displayName, store]);

  const ensureSession = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    try {
      await ensureSessionInner();
    } catch (err) {
      // A transport throw (fetch itself rejecting) rather than an ApiResult.
      // The typed client never throws, but an injected client can, and an
      // unhandled rejection here would leave the hook stuck in "creating"
      // forever — the one state the whole design promises not to reach.
      setError({
        code: "OFFLINE",
        message: err instanceof Error ? err.message : "network error",
        retryable: true,
      });
      setStatus("failed");
    } finally {
      inFlight.current = false;
    }
  }, [ensureSessionInner]);

  const rename = useCallback(
    async (body: UpdateMeRequest): Promise<boolean> => {
      const result = await client.updateMe(body);
      if (!result.ok) {
        setRenameError(result.error);
        return false;
      }
      setPlayer(result.data);
      setRenameError(null);

      // Task 3.13's other half: the moment a returning player becomes
      // identifiable, their pre-server history is worth attaching to them. The
      // token is read here rather than passed in because the client writes it
      // to storage after this callback's deps were computed — a stale closure
      // would upload nothing. Deliberately not awaited: the rename is the
      // user's intent and the migration is housekeeping.
      if (body.displayName !== undefined) {
        void runMigration();
      }
      return true;
    },
    [client, runMigration],
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
    migration: migration.state,
  };
}

/** Extracts the initials the server derived, for the compact board rows. */
export function playerInitials(player: AuthResponse["player"] | null): string {
  return player?.initials ?? "???";
}
