import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryRepositories } from "../adapters/memoryRepositories.js";
import type { PlayerRecord } from "../ports/repositories.js";
import { issueRunStartToken, verifyRunStartToken } from "../auth.js";
import { assessPlausibility } from "./anticheat.js";
import {
  ATTESTATION_INTERVAL_MS,
  TIMING_SLACK_MS,
  dailySeed,
  startRun,
  submitRun,
  utcDay,
  verifyAttestation,
  type RunServiceDeps,
} from "./runs.js";
import { fail, statusOf } from "../errors.js";
import { isAppError } from "../../src/core/errors/AppError.js";
import { HARNESS_SCORE_PER_SECOND_P99 } from "../../src/shared/calibration.js";

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** The client half of the attestation protocol. */
function chainFrom(nonce: string, links: number): string[] {
  const chain: string[] = [];
  let prev = nonce;
  for (let i = 0; i < links; i++) {
    prev = sha256(`${prev}:${i}`);
    chain.push(prev);
  }
  return chain;
}

interface Harness {
  deps: RunServiceDeps;
  /** Fast-forward the injected clock. */
  advance: (ms: number) => void;
  /** Reads the audit trail — where flagged and rejected runs are recorded. */
  audit: () => Promise<{ action: string; meta: Record<string, unknown> }[]>;
}

function harness(): Harness {
  const repos = createMemoryRepositories();
  let ms = Date.parse("2026-10-24T10:00:00.000Z");
  const deps: RunServiceDeps = {
    repos,
    authSecret: SECRET,
    now: () => new Date(ms),
    scorePerSecondP99: HARNESS_SCORE_PER_SECOND_P99,
  };
  return {
    deps,
    advance: (by) => {
      ms += by;
    },
    audit: async () =>
      (await repos.audit.list(50)).map((e) => ({ action: e.action, meta: e.meta as Record<string, unknown> })),
  };
}

/** Captures a rejected submission as its stable code plus HTTP status. */
async function rejection(promise: Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await promise;
  } catch (err) {
    if (isAppError(err)) return { code: err.code, status: statusOf(err) };
    throw err;
  }
  throw new Error("expected the submission to fail");
}

const PLAYER_ID = "11111111-2222-4333-8444-555555555555";

/** A full player record as the services expect to receive it. */
function playerRecord(overrides: Partial<PlayerRecord> = {}): PlayerRecord {
  const at = new Date("2026-10-24T09:00:00.000Z");
  return {
    id: PLAYER_ID,
    anonTokenHash: "h".repeat(64),
    displayName: "Nova",
    initials: "NOV",
    createdAt: at,
    lastSeenAt: at,
    totalRuns: 0,
    bestScore: 0,
    ...overrides,
  };
}

async function newPlayer(h: Harness): Promise<PlayerRecord> {
  return h.deps.repos.players.create(playerRecord());
}

describe("utcDay and dailySeed", () => {
  it("names the UTC calendar day", () => {
    expect(utcDay(new Date("2026-10-24T23:30:00.000Z"))).toBe("2026-10-24");
    // Just after midnight UTC is the next day, whatever the local zone says.
    expect(utcDay(new Date("2026-10-25T00:30:00.000Z"))).toBe("2026-10-25");
  });

  it("gives every player the same seed for the same day", () => {
    expect(dailySeed("2026-10-24")).toBe(dailySeed("2026-10-24"));
    expect(dailySeed("2026-10-24")).not.toBe(dailySeed("2026-10-25"));
    expect(dailySeed("2026-10-24")).toBeGreaterThanOrEqual(0);
    expect(dailySeed("2026-10-24")).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("verifyAttestation", () => {
  const nonce = "n".repeat(32);

  it("accepts a correctly chained run", () => {
    const chain = chainFrom(nonce, 120);
    expect(verifyAttestation({ nonce, chain }, nonce, 60_000)).toEqual({ ok: true });
  });

  it("rejects a chain that does not recompute", () => {
    const chain = chainFrom(nonce, 10);
    chain[5] = "f".repeat(64);
    expect(verifyAttestation({ nonce, chain }, nonce, 60_000).ok).toBe(false);
  });

  it("rejects a chain built from a different nonce", () => {
    const chain = chainFrom("0".repeat(32), 10);
    expect(verifyAttestation({ nonce, chain }, nonce, 60_000).ok).toBe(false);
  });

  it("flags a chain far shorter than the claimed duration", () => {
    const chain = chainFrom(nonce, 2);
    const result = verifyAttestation({ nonce, chain }, nonce, 60_000);
    expect(result.ok).toBe(true);
    expect(result.anomaly).toContain("far below expected");
  });

  it("tolerates a short chain on a short run", () => {
    expect(verifyAttestation({ nonce, chain: chainFrom(nonce, 2) }, nonce, 1_000)).toEqual({ ok: true });
  });

  it("derives the expected link count from the interval", () => {
    expect(ATTESTATION_INTERVAL_MS).toBe(500);
  });
});

describe("startRun", () => {
  it("issues a server-chosen seed for endless and the daily seed for daily", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const endless = await startRun(h.deps, player, { mode: "endless", clientVersion: "0.1.0" });
    const daily = await startRun(h.deps, player, { mode: "daily", clientVersion: "0.1.0" });
    expect(endless.seed).not.toBe(daily.seed);
    expect(daily.seed).toBe(dailySeed(daily.day));
    expect(endless.nonce).toHaveLength(32);
    expect(endless.day).toBe("2026-10-24");
  });

  it("signs the run into a token that verifies only for that run and player", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await startRun(h.deps, player, { mode: "endless", clientVersion: "0.1.0" });
    const ok = await verifyRunStartToken(start.startToken, SECRET, {
      runId: start.runId,
      playerId: player.id,
    });
    expect(ok?.nonce).toBe(start.nonce);
    // A different run id must not verify against this token.
    const wrong = await verifyRunStartToken(start.startToken, SECRET, {
      runId: "22222222-3333-4444-8555-666666666666",
      playerId: player.id,
    });
    expect(wrong).toBeNull();
    // Nor a different player.
    const otherPlayer = await verifyRunStartToken(start.startToken, SECRET, {
      runId: start.runId,
      playerId: "33333333-4444-4555-8666-777777777777",
    });
    expect(otherPlayer).toBeNull();
    // Nor a different secret.
    expect(
      await verifyRunStartToken(start.startToken, "another-secret-0123456789abcdef0123", {
        runId: start.runId,
        playerId: player.id,
      }),
    ).toBeNull();
  });
});

describe("submitRun", () => {
  const PLAUSIBLE = {
    score: 12_000,
    level: 22,
    chips: 150,
    kills: 20,
    maxCombo: 8,
    durationMs: 60_000,
  };

  async function started(h: Harness, playerId: string, mode: "endless" | "daily" = "endless") {
    return startRun(h.deps, playerRecord({ id: playerId }), { mode, clientVersion: "0.1.0" });
  }

  function submission(
    start: Awaited<ReturnType<typeof started>>,
    overrides: Partial<typeof PLAUSIBLE> & { chainLinks?: number; nonce?: string; startToken?: string } = {},
  ) {
    const durationMs = overrides.durationMs ?? PLAUSIBLE.durationMs;
    const nonce = overrides.nonce ?? start.nonce;
    const links = overrides.chainLinks ?? Math.max(1, Math.round(durationMs / ATTESTATION_INTERVAL_MS));
    return {
      startToken: overrides.startToken ?? start.startToken,
      score: overrides.score ?? PLAUSIBLE.score,
      level: overrides.level ?? PLAUSIBLE.level,
      chips: overrides.chips ?? PLAUSIBLE.chips,
      kills: overrides.kills ?? PLAUSIBLE.kills,
      maxCombo: overrides.maxCombo ?? PLAUSIBLE.maxCombo,
      durationMs,
      clientVersion: "0.1.0",
      attestation: { nonce, chain: chainFrom(nonce, links) },
    };
  }

  it("accepts a plausible run, updates totals and records nothing in the audit trail", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id);
    h.advance(60_000); // the run really took its minute
    const result = await submitRun(h.deps, playerRecord(), start.runId, submission(start));
    expect(result).toMatchObject({ accepted: true, validity: "ok", rank: 1, bestScore: 12_000 });
    expect(await h.audit()).toEqual([]);
    expect((await h.deps.repos.players.findById(player.id))?.bestScore).toBe(12_000);
    expect((await h.deps.repos.players.findById(player.id))?.totalRuns).toBe(1);
  });

  it("rejects a replayed run id", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id);
    h.advance(60_000);
    await submitRun(h.deps, playerRecord(), start.runId, submission(start));
    expect(await rejection(submitRun(h.deps, playerRecord(), start.runId, submission(start)))).toEqual({
      code: "CONFLICT",
      status: 409,
    });
  });

  it("404s a submission to a run id the start token was not issued for", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id);
    h.advance(60_000);
    // The token is genuine but bound to `start.runId`; claiming a different
    // run id must fail before anything is stored.
    expect(
      await rejection(submitRun(h.deps, playerRecord(), "99999999-8888-4777-8666-555555555555", submission(start))),
    ).toEqual({ code: "RUN_NOT_FOUND", status: 404 });
  });

  it("400s a token replayed against a chain from a different run", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id);
    h.advance(60_000);
    // A token minted for another run (with the server's own secret, the worst
    // case an insider could produce) still cannot carry another run's chain.
    const otherRun = await issueRunStartToken(
      {
        runId: "99999999-8888-4777-8666-555555555555",
        playerId: player.id,
        mode: "endless",
        day: "2026-10-24",
        seed: 1,
        nonce: "a".repeat(32),
      },
      SECRET,
      h.deps.now,
    );
    expect(
      await rejection(
        submitRun(
          h.deps,
          playerRecord(),
          "99999999-8888-4777-8666-555555555555",
          submission(start, { startToken: otherRun }),
        ),
      ),
    ).toEqual({ code: "ATTESTATION_FAILED", status: 400 });
  });

  it("400s an attestation that does not verify", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id);
    h.advance(60_000);
    expect(
      await rejection(submitRun(h.deps, playerRecord(), start.runId, submission(start, { nonce: "b".repeat(32) }))),
    ).toEqual({ code: "ATTESTATION_FAILED", status: 400 });
  });

  it("stores an impossible run as rejected and audits it, without touching totals", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id);
    h.advance(60_000);
    const result = await submitRun(
      h.deps,
      playerRecord(),
      start.runId,
      submission(start, { score: 900_000, chips: 1000, level: 100 }),
    );
    expect(result.accepted).toBe(false);
    expect(result.validity).toBe("rejected");
    expect(result.rank).toBeNull();
    expect(result.bestScore).toBe(0);
    const audit = await h.audit();
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("run.rejected");
    expect((await h.deps.repos.players.findById(player.id))?.bestScore).toBe(0);
  });

  it("stores a statistically implausible run as suspect, audits it and hides it from the board", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id);
    h.advance(60_000);
    const result = await submitRun(
      h.deps,
      playerRecord(),
      start.runId,
      submission(start, { score: 25_000, chips: 300, level: 43 }),
    );
    expect(result).toMatchObject({ accepted: false, validity: "suspect", rank: null });
    expect((await h.audit())[0].action).toBe("run.flagged");
    const board = await h.deps.repos.runs.globalBoard("endless", 10);
    expect(board).toHaveLength(0);
  });

  it("flags a run submitted before its claimed duration could have elapsed", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id);
    // No advance: 60 seconds of play claimed, zero elapsed.
    const result = await submitRun(h.deps, playerRecord(), start.runId, submission(start));
    expect(result.validity).toBe("suspect");
    expect(result.accepted).toBe(false);
    expect((await h.audit())[0].action).toBe("run.flagged");
  });

  it("tolerates small clock skew inside the slack", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id);
    h.advance(60_000 - TIMING_SLACK_MS + 1_000); // 9s of skew, inside the 10s slack
    const result = await submitRun(h.deps, playerRecord(), start.runId, submission(start));
    expect(result.validity).toBe("ok");
  });

  it("keeps the server-issued mode and day, whatever the client claims", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id, "daily");
    h.advance(60_000);
    await submitRun(h.deps, playerRecord(), start.runId, submission(start));
    const stored = await h.deps.repos.runs.findById(start.runId);
    expect(stored?.mode).toBe("daily");
    expect(stored?.day).toBe("2026-10-24");
    expect(stored?.seed).toBe(dailySeed("2026-10-24"));
  });

  it("stores the run even when it is rejected — a rejected run is evidence", async () => {
    const h = harness();
    const player = await newPlayer(h);
    const start = await started(h, player.id);
    h.advance(60_000);
    await submitRun(
      h.deps,
      playerRecord(),
      start.runId,
      submission(start, { score: 900_000, chips: 1000, level: 100 }),
    );
    const stored = await h.deps.repos.runs.findById(start.runId);
    expect(stored).not.toBeNull();
    expect(stored?.score).toBe(900_000);
    expect(stored?.validity).toBe("rejected");
    expect(stored?.attestation).toEqual({ nonce: start.nonce, links: 120 });
  });
});

describe("error contract", () => {
  it("fail() carries a stable code and status", () => {
    const error = fail("VALIDATION_FAILED", "nope", 400);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.message).toBe("nope");
    expect(statusOf(error)).toBe(400);
    expect(statusOf(new Error("plain"))).toBe(500);
  });
});

describe("the two tiers agree", () => {
  it("a timing cheat is never structurally rejected", () => {
    // The envelope checks must not fire on a plausible 60s run — only the
    // suspect tier is allowed to judge how fast a human can play.
    const result = assessPlausibility(
      { score: 12_000, level: 22, chips: 150, kills: 20, maxCombo: 8, durationMs: 60_000 },
      { scorePerSecondP99: HARNESS_SCORE_PER_SECOND_P99 },
    );
    expect(result.verdict).toBe("ok");
  });
});
