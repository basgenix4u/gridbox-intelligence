import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createMemoryRepositories } from "../adapters/memoryRepositories.js";
import type { Repositories } from "../ports/repositories.js";
import type { RunStartResponse } from "../../src/shared/contracts.js";

/**
 * End-to-end API tests over the real Hono app with in-memory repositories.
 *
 * These exercise the whole surface the client will use: anonymous auth, the
 * profile, the run lifecycle with attestation and anti-cheat, both board
 * scopes, the moderation queue and the rate limits — no database, no network,
 * fully deterministic.
 */

const AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const MODERATION_TOKEN = "moderator-token-0123456789abcdef";
const T0 = Date.parse("2026-10-24T10:00:00.000Z");

/**
 * The app's clock. Each `makeApp()` resets it, so every test starts at the
 * same instant and can fast-forward through the play time of a run — which is
 * what makes the wall-clock envelope check testable without sleeping.
 */
const clock = { ms: T0 };
const nowFn = (): Date => new Date(clock.ms);
function advance(ms: number): void {
  clock.ms += ms;
}

function makeApp(repos: Repositories = createMemoryRepositories()) {
  clock.ms = T0;
  return createApp({
    envSource: {
      NODE_ENV: "test",
      AUTH_SECRET,
      MODERATION_TOKEN,
      ALLOWED_ORIGINS: "*",
      SERVICE_VERSION: "test",
    },
    repositories: repos,
    rateLimiter: undefined,
    now: nowFn,
  });
}

/** The client side of the attestation chain: link i = sha256(previous:i). */
function buildChain(nonce: string, links: number): string[] {
  const chain: string[] = [];
  let prev = nonce;
  for (let i = 0; i < links; i++) {
    prev = createHash("sha256").update(`${prev}:${i}`).digest("hex");
    chain.push(prev);
  }
  return chain;
}

async function auth(
  app: ReturnType<typeof makeApp>,
  displayName?: string,
): Promise<{ token: string; playerId: string }> {
  const res = await app.request("/v1/auth/anonymous", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(displayName === undefined ? {} : { displayName }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string; player: { id: string } };
  return { token: body.token, playerId: body.player.id };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

interface SubmitOverrides {
  score?: number;
  chips?: number;
  level?: number;
  kills?: number;
  maxCombo?: number;
  durationMs?: number;
  nonce?: string;
  chainLinks?: number;
  startToken?: string;
  /** Simulate the player NOT taking the claimed time (the timing cheat). */
  skipPlayTime?: boolean;
}

async function submit(
  app: ReturnType<typeof makeApp>,
  token: string,
  runId: string,
  start: RunStartResponse,
  overrides: SubmitOverrides = {},
) {
  const durationMs = overrides.durationMs ?? 60_000;
  const nonce = overrides.nonce ?? start.nonce;
  const links = overrides.chainLinks ?? Math.max(1, Math.round(durationMs / 500));
  // The run genuinely takes as long as it claims, unless the test is probing
  // the wall-clock envelope.
  if (!overrides.skipPlayTime) advance(durationMs);
  const res = await app.request(`/v1/runs/${runId}/submit`, {
    method: "POST",
    headers: bearer(token),
    body: JSON.stringify({
      startToken: overrides.startToken ?? start.startToken,
      score: overrides.score ?? 12_000,
      level: overrides.level ?? 22,
      chips: overrides.chips ?? 150,
      maxCombo: overrides.maxCombo ?? 8,
      kills: overrides.kills ?? 20,
      durationMs,
      clientVersion: "0.1.0",
      attestation: { nonce, chain: buildChain(nonce, links) },
    }),
  });
  return res;
}

describe("POST /v1/auth/anonymous", () => {
  it("mints a session and a player", async () => {
    const app = makeApp();
    const res = await app.request("/v1/auth/anonymous", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; player: { displayName: string; initials: string } };
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.player.displayName).toBe("YOU");
    expect(body.player.initials).toBe("YOU");
  });

  it("rejects a profane requested name", async () => {
    const app = makeApp();
    const res = await app.request("/v1/auth/anonymous", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "f u c k" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NAME_REJECTED");
  });

  it("accepts a clean requested name and derives initials", async () => {
    const app = makeApp();
    const res = await app.request("/v1/auth/anonymous", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Nova" }),
    });
    const body = (await res.json()) as { player: { displayName: string; initials: string } };
    expect(body.player.displayName).toBe("Nova");
    expect(body.player.initials).toBe("NOV");
  });
});

describe("session guard", () => {
  it("401s /me without a token", async () => {
    const app = makeApp();
    const res = await app.request("/v1/me");
    expect(res.status).toBe(401);
  });

  it("401s /me with a garbage token", async () => {
    const app = makeApp();
    const res = await app.request("/v1/me", { headers: { authorization: "Bearer not-a-jwt" } });
    expect(res.status).toBe(401);
  });

  it("503s protected routes when no database is configured", async () => {
    const app = createApp({
      envSource: { NODE_ENV: "test", AUTH_SECRET, ALLOWED_ORIGINS: "*" },
      repositories: undefined,
      db: null,
    });
    const res = await app.request("/v1/me", { headers: { authorization: "Bearer x" } });
    // Without persistence the routes are not mounted at all — a clear 404,
    // while /readyz stays the single place that reports the misconfiguration.
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });
});

describe("GET /v1/me and PATCH /v1/me", () => {
  it("returns the player profile", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const res = await app.request("/v1/me", { headers: bearer(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bestScore: number; totalRuns: number };
    expect(body.bestScore).toBe(0);
    expect(body.totalRuns).toBe(0);
  });

  it("updates the display name and re-derives initials", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const res = await app.request("/v1/me", {
      method: "PATCH",
      headers: bearer(token),
      body: JSON.stringify({ displayName: "Vega" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { displayName: string; initials: string };
    expect(body.displayName).toBe("Vega");
    expect(body.initials).toBe("VEG");
  });

  it("rejects an implausible name and an invalid initials pair", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const bad = await app.request("/v1/me", {
      method: "PATCH",
      headers: bearer(token),
      body: JSON.stringify({ displayName: "sh!t" }),
    });
    expect(bad.status).toBe(400);

    const badInitials = await app.request("/v1/me", {
      method: "PATCH",
      headers: bearer(token),
      body: JSON.stringify({ initials: "FUK" }),
    });
    expect(badInitials.status).toBe(400);
  });
});

describe("run lifecycle", () => {
  it("issues a signed start token with a server-chosen seed", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const res = await app.request("/v1/runs/start", {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as RunStartResponse;
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isInteger(body.seed)).toBe(true);
    expect(body.nonce).toHaveLength(32);
    expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("accepts a plausible run, ranks it and updates totals", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;

    const res = await submit(app, token, start.runId, start);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: boolean; validity: string; rank: number | null; bestScore: number };
    expect(body.accepted).toBe(true);
    expect(body.validity).toBe("ok");
    expect(body.rank).toBe(1);
    expect(body.bestScore).toBe(12_000);

    const me = (await (await app.request("/v1/me", { headers: bearer(token) })).json()) as { totalRuns: number };
    expect(me.totalRuns).toBe(1);
  });

  it("rejects a replayed run id with 409", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    expect((await submit(app, token, start.runId, start)).status).toBe(200);
    const replay = await submit(app, token, start.runId, start);
    expect(replay.status).toBe(409);
  });

  it("fails a submission whose attestation does not verify", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    const res = await submit(app, token, start.runId, start, { nonce: "0".repeat(32) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ATTESTATION_FAILED");
  });

  it("404s a submission for an unknown run", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    const res = await submit(app, token, "11111111-2222-4333-8444-555555555555", start);
    expect(res.status).toBe(404);
  });

  it("stores an impossible run as rejected and keeps it off the board", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    // 900k points in 60s is 15,000/s — above the physical ceiling.
    const res = await submit(app, token, start.runId, start, {
      score: 900_000,
      chips: 1000,
      level: 100,
      durationMs: 60_000,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: boolean; validity: string };
    expect(body.accepted).toBe(false);
    expect(body.validity).toBe("rejected");

    const board = (await (await app.request("/v1/leaderboard")).json()) as { rows: unknown[] };
    expect(board.rows).toHaveLength(0);
  });

  it("flags a statistically implausible run as suspect and hides it", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    // 417/s — structurally possible, above the harness p99 + 20% margin.
    const res = await submit(app, token, start.runId, start, {
      score: 25_000,
      chips: 300,
      level: 43,
      durationMs: 60_000,
    });
    const body = (await res.json()) as { accepted: boolean; validity: string };
    expect(body.accepted).toBe(false);
    expect(body.validity).toBe("suspect");

    const board = (await (await app.request("/v1/leaderboard")).json()) as { rows: unknown[] };
    expect(board.rows).toHaveLength(0);
  });

  it("flags a run submitted long before its claimed duration elapsed", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    // The clock never advances: a 60-second run submitted the instant it
    // started cannot have been played. The stats are plausible, so only the
    // wall-clock envelope catches it.
    const res = await submit(app, token, start.runId, start, { skipPlayTime: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: boolean; validity: string };
    expect(body.accepted).toBe(false);
    expect(body.validity).toBe("suspect");

    const board = (await (await app.request("/v1/leaderboard")).json()) as { rows: unknown[] };
    expect(board.rows).toHaveLength(0);
  });

  it("flags a run whose attestation chain is far too short", async () => {
    const app = makeApp();
    const { token } = await auth(app);
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    const res = await submit(app, token, start.runId, start, { durationMs: 60_000, chainLinks: 2 });
    const body = (await res.json()) as { validity: string };
    expect(body.validity).toBe("suspect");
  });
});

describe("leaderboards", () => {
  async function playRun(
    app: ReturnType<typeof makeApp>,
    token: string,
    score: number,
    chips: number,
    mode: "endless" | "daily" = "endless",
  ): Promise<void> {
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ mode, clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    await submit(app, token, start.runId, start, { score, chips, level: 1 + Math.floor(chips / 7) });
  }

  it("ranks the global board by best run per player", async () => {
    const app = makeApp();
    const a = await auth(app, "Alpha");
    const b = await auth(app, "Bravo");
    await playRun(app, a.token, 5_000, 80);
    await playRun(app, b.token, 9_000, 120);
    await playRun(app, a.token, 7_000, 100); // not a new best for A

    const board = (await (await app.request("/v1/leaderboard")).json()) as {
      rows: { rank: number; initials: string; score: number }[];
    };
    expect(board.rows.map((r) => r.initials)).toEqual(["BRA", "ALP"]);
    expect(board.rows.map((r) => r.score)).toEqual([9_000, 7_000]);
    expect(board.rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("returns the caller's neighbourhood with isYou", async () => {
    const app = makeApp();
    const players = [];
    for (const name of ["Aa", "Bb", "Cc", "Dd", "Ee"]) {
      players.push(await auth(app, name));
    }
    const scores = [1_000, 3_000, 5_000, 7_000, 9_000];
    for (let i = 0; i < players.length; i++) {
      await playRun(app, players[i].token, scores[i], 60);
    }
    const res = await app.request("/v1/leaderboard/around", { headers: bearer(players[2].token) });
    const body = (await res.json()) as { rows: { rank: number; isYou: boolean }[] };
    expect(body.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(body.rows.find((r) => r.isYou)?.rank).toBe(3);
  });

  it("serves the daily board for the run's day", async () => {
    const app = makeApp();
    const a = await auth(app, "Alpha");
    await playRun(app, a.token, 4_000, 60, "daily");
    const res = await app.request("/v1/leaderboard/daily");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scope: string; rows: { initials: string; score: number }[] };
    expect(body.scope).toBe("daily");
    expect(body.rows[0]).toMatchObject({ initials: "ALP", score: 4_000 });
  });

  it("rate-limits board reads", async () => {
    const app = makeApp();
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) {
      statuses.push((await app.request("/v1/leaderboard")).status);
    }
    expect(statuses.filter((s) => s === 200).length).toBe(120);
    expect(statuses.filter((s) => s === 429).length).toBe(5);
  });
});

describe("moderation", () => {
  it("holds a reported name off the board until a moderator clears it", async () => {
    const app = makeApp();
    const offender = await auth(app, "Badname");
    const reporter = await auth(app, "Snitch");
    await playRunGlobal(app, offender.token, 9_000, 120);

    // Before the report the name is on the board.
    let board = (await (await app.request("/v1/leaderboard")).json()) as { rows: { initials: string }[] };
    expect(board.rows.map((r) => r.initials)).toContain("BAD");

    const reportRes = await app.request(`/v1/names/${offender.playerId}/report`, {
      method: "POST",
      headers: bearer(reporter.token),
      body: JSON.stringify({ reason: "offensive name" }),
    });
    expect(reportRes.status).toBe(201);

    // After the report the name is held off every board.
    board = (await (await app.request("/v1/leaderboard")).json()) as { rows: { initials: string }[] };
    expect(board.rows.map((r) => r.initials)).not.toContain("BAD");

    // The queue is guarded by the moderator token.
    const noToken = await app.request("/v1/admin/moderation");
    expect(noToken.status).toBe(401);
    const wrongToken = await app.request("/v1/admin/moderation", {
      headers: { authorization: "Bearer wrong-token-0123456789abcdef" },
    });
    expect(wrongToken.status).toBe(401);

    const queue = (await (
      await app.request("/v1/admin/moderation", { headers: { authorization: `Bearer ${MODERATION_TOKEN}` } })
    ).json()) as { rows: { id: number; reportedName: string }[] };
    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0].reportedName).toBe("Badname");

    // Clear the report — the name flows back.
    const clear = await app.request(`/v1/admin/moderation/${queue.rows[0].id}`, {
      method: "POST",
      headers: { authorization: `Bearer ${MODERATION_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    });
    expect(clear.status).toBe(200);
    board = (await (await app.request("/v1/leaderboard")).json()) as { rows: { initials: string }[] };
    expect(board.rows.map((r) => r.initials)).toContain("BAD");
  });

  it("upholding a report resets the offender's name", async () => {
    const app = makeApp();
    const offender = await auth(app, "Badname");
    const reporter = await auth(app, "Snitch");
    const reportRes = await app.request(`/v1/names/${offender.playerId}/report`, {
      method: "POST",
      headers: bearer(reporter.token),
      body: JSON.stringify({ reason: "offensive name" }),
    });
    const { reportId } = (await reportRes.json()) as { reportId: number };
    const uphold = await app.request(`/v1/admin/moderation/${reportId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${MODERATION_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "uphold" }),
    });
    expect(uphold.status).toBe(200);
    const me = (await (await app.request("/v1/me", { headers: bearer(offender.token) })).json()) as {
      displayName: string;
    };
    expect(me.displayName).toBe("YOU");
  });

  it("refuses self-reports and unknown players", async () => {
    const app = makeApp();
    const a = await auth(app, "Alpha");
    const selfReport = await app.request(`/v1/names/${a.playerId}/report`, {
      method: "POST",
      headers: bearer(a.token),
      body: JSON.stringify({ reason: "testing" }),
    });
    expect(selfReport.status).toBe(400);
    const ghost = await app.request("/v1/names/11111111-2222-4333-8444-555555555555/report", {
      method: "POST",
      headers: bearer(a.token),
      body: JSON.stringify({ reason: "testing" }),
    });
    expect(ghost.status).toBe(404);
  });
});

describe("CORS allowlist", () => {
  const ORIGIN = "https://gridbox-intelligence.vercel.app";

  function appWithOrigins(origins: string, nodeEnv = "test") {
    clock.ms = T0;
    return createApp({
      envSource: { NODE_ENV: nodeEnv, AUTH_SECRET, ALLOWED_ORIGINS: origins },
      repositories: createMemoryRepositories(),
      now: nowFn,
    });
  }

  it("reflects an allowlisted origin", async () => {
    const app = appWithOrigins(ORIGIN);
    const res = await app.request("/v1/healthz", { headers: { origin: ORIGIN } });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("does not approve an unknown origin", async () => {
    const app = appWithOrigins(ORIGIN);
    const res = await app.request("/v1/healthz", { headers: { origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("approves every origin in development's default", async () => {
    const app = appWithOrigins("*");
    const res = await app.request("/v1/healthz", { headers: { origin: "https://anything.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("fails closed in production when the allowlist was never pinned", async () => {
    // A production deployment that forgot its allowlist must not become a
    // free-for-all: no origin is approved, and /readyz says why.
    const app = appWithOrigins("*", "production");
    const res = await app.request("/v1/healthz", { headers: { origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const ready = await app.request("/v1/readyz");
    expect(ready.status).toBe(503);
    const body = (await ready.json()) as { status: string; problems: string[] };
    expect(body.status).toBe("degraded");
    expect(body.problems.join(" ")).toContain("ALLOWED_ORIGINS");
  });

  it("approves the pinned origin in production", async () => {
    const app = appWithOrigins(ORIGIN, "production");
    const res = await app.request("/v1/healthz", { headers: { origin: ORIGIN } });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });
});

describe("rate limiting", () => {
  it("throttles anonymous session creation per IP", async () => {
    const app = makeApp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (
          await app.request("/v1/auth/anonymous", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status,
      );
    }
    expect(statuses.filter((s) => s === 201).length).toBe(10);
    expect(statuses.filter((s) => s === 429).length).toBe(2);
  });
});

async function playRunGlobal(app: ReturnType<typeof makeApp>, token: string, score: number, chips: number) {
  const start = (await (
    await app.request("/v1/runs/start", {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
    })
  ).json()) as RunStartResponse;
  await submit(app, token, start.runId, start, { score, chips, level: 1 + Math.floor(chips / 7) });
}
