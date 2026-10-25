/**
 * Server-verified runs (task 4.1b).
 *
 * The client half of the run lifecycle: ask the server to start a run, play
 * with the seed it issued while hashing an attestation chain, then submit.
 *
 * The important property is the **fallback**. Every step here can fail — no
 * network, a rotated secret, a rate limit, a server that is down. None of
 * those may stop anyone playing, because the game was fully playable before
 * the server existed and must stay that way. So:
 *
 * - A run that cannot be *started* on the server still plays, locally seeded.
 * - A run that cannot be *submitted* is still recorded in the local table, so
 *   the player keeps their score and it counts for the next sync attempt.
 * - The only thing the player loses when the server is unreachable is the
 *   leaderboard — which is exactly the right trade.
 *
 * `state` is deliberately a small discriminated union rather than several
 * booleans: "no run", "playing", "submitting" and "submitted" are mutually
 * exclusive, and the type should say so.
 */

import { useCallback, useRef, useState } from "react";
import type { RunMode, RunStartResponse, RunSubmitResponse } from "../shared/contracts.js";
import { Attestor } from "./attestation.js";
import type { GameApiClient } from "./apiClient.js";

export type RunPhase =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "playing"; run: RunStartResponse; attestor: Attestor }
  | { status: "submitting" }
  | { status: "submitted"; result: RunSubmitResponse }
  | { status: "local-only"; reason: string };

/** What the game loop reports when a run ends. */
export interface RunOutcome {
  score: number;
  level: number;
  chips: number;
  maxCombo: number;
  kills: number;
  durationMs: number;
}

export interface UseVerifiedRunDeps {
  client: GameApiClient;
  /** Called when the server refuses a run start — the game falls back. */
  onFallback?: (reason: string) => void;
  /** Called after a successful submit, so the UI can celebrate a rank. */
  onSubmitted?: (result: RunSubmitResponse) => void;
}

export interface UseVerifiedRunResult {
  phase: RunPhase;
  /** Asks the server to start a run. Resolves even when the server says no. */
  startRun: (mode: RunMode) => Promise<RunStartResponse | null>;
  /** Feeds the attestation chain. Call from the game loop. */
  attest: (nowMs: number) => void;
  /** Ends the run: attests, submits, and reports what happened. */
  finishRun: (outcome: RunOutcome) => Promise<RunSubmitResponse | null>;
  /** Clears back to idle. */
  reset: () => void;
}

export function useVerifiedRun(deps: UseVerifiedRunDeps): UseVerifiedRunResult {
  const [phase, setPhase] = useState<RunPhase>({ status: "idle" });
  const runRef = useRef<{ run: RunStartResponse; attestor: Attestor } | null>(null);

  const startRun = useCallback(
    async (mode: RunMode): Promise<RunStartResponse | null> => {
      setPhase({ status: "starting" });
      const result = await deps.client.startRun(mode);
      if (!result.ok) {
        // The game continues with a local seed; the run just will not be
        // server-verified. That is a degraded leaderboard entry, not a
        // broken game.
        const reason = result.error.code === "OFFLINE" ? "offline" : result.error.message;
        runRef.current = null;
        setPhase({ status: "local-only", reason });
        deps.onFallback?.(reason);
        return null;
      }
      runRef.current = { run: result.data, attestor: new Attestor(result.data.nonce) };
      setPhase({ status: "playing", run: result.data, attestor: runRef.current.attestor });
      return result.data;
    },
    [deps],
  );

  const attest = useCallback((nowMs: number): void => {
    runRef.current?.attestor.tick(nowMs);
  }, []);

  const finishRun = useCallback(
    async (outcome: RunOutcome): Promise<RunSubmitResponse | null> => {
      const current = runRef.current;
      if (!current) return null;

      setPhase({ status: "submitting" });
      const attestation = await current.attestor.finish();

      const result = await deps.client.submitRun(current.run.runId, {
        startToken: current.run.startToken,
        score: outcome.score,
        level: outcome.level,
        chips: outcome.chips,
        maxCombo: outcome.maxCombo,
        kills: outcome.kills,
        durationMs: outcome.durationMs,
        attestation,
      });

      runRef.current = null;
      if (!result.ok) {
        setPhase({ status: "local-only", reason: result.error.message });
        return null;
      }
      setPhase({ status: "submitted", result: result.data });
      deps.onSubmitted?.(result.data);
      return result.data;
    },
    [deps],
  );

  const reset = useCallback((): void => {
    runRef.current = null;
    setPhase({ status: "idle" });
  }, []);

  return { phase, startRun, attest, finishRun, reset };
}
