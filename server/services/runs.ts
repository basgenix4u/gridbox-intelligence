import type { Repositories } from "../ports/repositories.js";
import type { PlayerRecord } from "../ports/repositories.js";
import {
  CURRENT_SCORING_VERSION,
  type RunAttestation,
  type RunMode,
  type RunStartRequest,
  type RunStartResponse,
  type RunSubmitRequest,
  type RunSubmitResponse,
} from "../../src/shared/contracts.js";
import { issueRunStartToken, newRunId, randomNonce, randomSeed, sha256Hex, verifyRunStartToken } from "../auth.js";
import { assessPlausibility } from "./anticheat.js";
import { fail } from "../errors.js";

/**
 * Run lifecycle (tasks 3.7 + 3.8).
 *
 * start: the server issues the run id, the seed and the attestation nonce, and
 * signs them into a short-lived start token. The client cannot choose its own
 * seed, so the daily challenge is fair and a replayed run is detectable.
 *
 * submit: the start token is verified, the run id must be unused, the
 * attestation chain is recomputed, and the stats are assessed for
 * plausibility before anything is stored. Only an "ok" run touches the
 * player's totals and the boards.
 */

export interface RunServiceDeps {
  repos: Repositories;
  authSecret: string;
  now: () => Date;
  /** p99 score-per-second from the balance harness, when measured. */
  scorePerSecondP99?: number;
}

/** UTC calendar day (YYYY-MM-DD) — the daily board's identity. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Deterministic daily seed: same day, same board, for every player. */
export function dailySeed(day: string): number {
  return Number.parseInt(sha256Hex(`gridbox-daily:${day}`).slice(0, 8), 16) >>> 0;
}

export async function startRun(
  deps: RunServiceDeps,
  player: PlayerRecord,
  req: RunStartRequest,
): Promise<RunStartResponse> {
  const day = utcDay(deps.now());
  const seed = req.mode === "daily" ? dailySeed(day) : randomSeed();
  const runId = newRunId();
  const nonce = randomNonce();
  const startToken = await issueRunStartToken(
    { runId, playerId: player.id, mode: req.mode, day, seed, nonce },
    deps.authSecret,
  );
  return { runId, seed, nonce, mode: req.mode, day, startToken };
}

/** One attestation link per this many milliseconds of play. */
export const ATTESTATION_INTERVAL_MS = 500;

export interface AttestationCheck {
  ok: boolean;
  /** Non-fatal anomaly — contributes a "suspect" reason. */
  anomaly?: string;
}

/**
 * Recomputes the client's hash chain. chain[i] = sha256(chain[i-1]:i) with
 * chain[-1] = nonce, so a replayer cannot forge a chain without the nonce the
 * server issued for this exact run.
 */
export function verifyAttestation(attestation: RunAttestation, nonce: string, durationMs: number): AttestationCheck {
  let prev = nonce;
  for (let i = 0; i < attestation.chain.length; i++) {
    prev = sha256Hex(`${prev}:${i}`);
    if (prev !== attestation.chain[i]) {
      return { ok: false };
    }
  }
  const expected = Math.max(1, Math.round(durationMs / ATTESTATION_INTERVAL_MS));
  if (attestation.chain.length < expected / 4) {
    return { ok: true, anomaly: `attestation chain length ${attestation.chain.length} far below expected ${expected}` };
  }
  return { ok: true };
}

export async function submitRun(
  deps: RunServiceDeps,
  player: PlayerRecord,
  runId: string,
  req: RunSubmitRequest,
): Promise<RunSubmitResponse> {
  // 1. The start token binds this run id, player, seed and nonce together.
  const claims = await verifyRunStartToken(req.startToken, deps.authSecret, { runId, playerId: player.id });
  if (!claims) {
    throw fail("RUN_NOT_FOUND", "Unknown or expired run — start a run before submitting it", 404);
  }

  // 2. A run id is single-use: replays die here.
  const existing = await deps.repos.runs.findById(runId);
  if (existing) {
    throw fail("CONFLICT", "This run was already submitted", 409);
  }

  // 3. Attestation: the nonce must match, and the chain must recompute.
  const attestation = verifyAttestation(req.attestation, claims.nonce, req.durationMs);
  if (!attestation.ok) {
    throw fail("ATTESTATION_FAILED", "Run attestation did not verify", 400);
  }

  // 4. Plausibility — two-tier (reject the impossible, flag the implausible).
  const assessment = assessPlausibility(
    {
      score: req.score,
      level: req.level,
      chips: req.chips,
      kills: req.kills,
      maxCombo: req.maxCombo,
      durationMs: req.durationMs,
    },
    { scorePerSecondP99: deps.scorePerSecondP99 },
  );
  const reasons = attestation.anomaly ? [...assessment.reasons, attestation.anomaly] : assessment.reasons;
  let validity = assessment.verdict;
  if (attestation.anomaly && validity === "ok") validity = "suspect";

  // 5. Store the run either way — a rejected run is evidence, not noise.
  const stored = await deps.repos.runs.insert({
    id: runId,
    playerId: player.id,
    mode: claims.mode as RunMode,
    seed: claims.seed,
    day: claims.day,
    score: req.score,
    level: req.level,
    chips: req.chips,
    maxCombo: req.maxCombo,
    kills: req.kills,
    durationMs: req.durationMs,
    clientVersion: req.clientVersion,
    attestation: { nonce: req.attestation.nonce, links: req.attestation.chain.length },
    validity,
    scoringVersion: CURRENT_SCORING_VERSION,
  });

  let rank: number | null = null;
  let bestScore = player.bestScore;

  if (validity === "ok") {
    // 6. Only verified runs count toward totals and boards.
    const updated = await deps.repos.players.addRunTotals(player.id, req.score);
    bestScore = updated.bestScore;
    await deps.repos.runs.upsertDailyBest({
      day: claims.day,
      mode: claims.mode as RunMode,
      playerId: player.id,
      initials: player.initials,
      score: req.score,
    });
    const around = await deps.repos.runs.around(player.id, claims.mode as RunMode, 0);
    rank = around.rank;
  } else {
    await deps.repos.audit.log({
      actor: player.id,
      action: validity === "rejected" ? "run.rejected" : "run.flagged",
      meta: { runId: stored.id, score: req.score, durationMs: req.durationMs, reasons },
    });
  }

  return { accepted: validity === "ok", validity, rank, bestScore };
}
