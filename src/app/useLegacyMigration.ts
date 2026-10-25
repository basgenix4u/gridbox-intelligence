/**
 * The legacy-migration trigger (task 4.1b — the missing half of 3.13).
 *
 * Task 3.13 built `POST /v1/me/migrate-scores` and the client module that
 * uploads a returning player's pre-server history. Nothing ever called it, so
 * a player who had scores before this upgrade still saw an empty profile.
 * This hook is the call.
 *
 * When it fires: **when the player sets a username.** That is the moment a
 * returning player becomes identifiable — before it there is nothing to attach
 * a history to, and after it one upload is enough because the server dedupes
 * on the browser's own entry ids.
 *
 * What it guarantees:
 *
 * - **At most one attempt per browser**, recorded only once the server has
 *   accepted the batch. A failure leaves the flag unset, so the next rename
 *   retries — and the server's dedupe makes the retry safe even if the flag is
 *   lost entirely.
 * - **Never blocks or breaks the rename.** The rename is the user's intent; the
 *   migration is housekeeping. It runs afterwards, and its outcome is reported
 *   for the UI to show, never thrown.
 * - **Silent when there is nothing to do.** No local scores, no session, or an
 *   earlier successful upload all resolve immediately without a request.
 */

import { useCallback, useRef, useState } from "react";
import type { KeyValueStore } from "../core/ports/storage.js";
import { createLocalStorageStore } from "../core/adapters/localStorageStore.js";
import { migrateLocalScores, type MigrationOutcome } from "./migrateLocalScores.js";

export type MigrationState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; outcome: MigrationOutcome };

export interface UseLegacyMigrationDeps {
  /**
   * Session token; without one there is nothing to migrate into. A function is
   * accepted because the token is written to storage by the API client *after*
   * this hook's deps were computed — a captured value would be `null` on the
   * first render and stay stale.
   */
  token: string | null | (() => string | null);
  store?: KeyValueStore;
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export interface UseLegacyMigrationResult {
  state: MigrationState;
  /**
   * Uploads the local history once. Call after a successful rename. Resolves
   * with the outcome; never rejects.
   */
  runMigration: () => Promise<MigrationOutcome>;
}

export function useLegacyMigration(deps: UseLegacyMigrationDeps): UseLegacyMigrationResult {
  const [state, setState] = useState<MigrationState>({ status: "idle" });
  // Two renames in quick succession must not race two uploads.
  const inFlight = useRef(false);

  // Destructured so the callback below closes over values, not the `deps`
  // object — `react-hooks/exhaustive-deps` can then see every one of them.
  const { token, store, fetchImpl, baseUrl } = deps;

  const runMigration = useCallback(async (): Promise<MigrationOutcome> => {
    if (inFlight.current) return { status: "already-migrated" };
    inFlight.current = true;
    setState({ status: "running" });
    try {
      const outcome = await migrateLocalScores({
        token: typeof token === "function" ? token() : token,
        // Created here rather than at render time: a fresh store per render
        // would make this callback unstable for no reason.
        store: store ?? createLocalStorageStore(),
        fetchImpl,
        baseUrl,
      });
      setState({ status: "done", outcome });
      return outcome;
    } finally {
      inFlight.current = false;
    }
  }, [baseUrl, fetchImpl, store, token]);

  return { state, runMigration };
}
