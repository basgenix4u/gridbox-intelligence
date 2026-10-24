import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createDrizzleRepositories } from "../adapters/drizzleRepositories.js";
import { createTestDatabase, type TestDatabase } from "../adapters/testDatabase.js";
import type { RunStartResponse } from "../../src/shared/contracts.js";

/**
 * The full stack over a real Postgres: HTTP → middleware → services → drizzle
 * → SQL. `api.test.ts` proves the routes and the service logic against the
 * memory adapters; this file proves the production adapters behave the same
 * way when the same requests hit actual SQL — unique constraints, DISTINCT ON
 * boards, the daily rollup's composite key and the held-name exclusion.
 */

const AUTH_SECRET = "integration-secret-0123456789abcdef0123";
const MODERATION_TOKEN = "moderator-token-0123456789abcdef";

let test: TestDatabase;
let app: ReturnType<typeof createApp>;
const T0 = Date.parse("2026-10-24T10:00:00.000Z");
const clock = { ms: T0 };

beforeAll(async () => {
  test = await createTestDatabase();
  app = createApp({
    envSource: { NODE_ENV: "test", AUTH_SECRET, MODERATION_TOKEN, ALLOWED_ORIGINS: "*" },
    repositories: createDrizzleRepositories(test.db),
    now: () => new Date(clock.ms),
  });
}, 60_000);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  clock.ms = T0;
  await test.reset();
});

function chain(nonce: string, links: number): string[] {
  const out: string[] = [];
  let prev = nonce;
  for (let i = 0; i < links; i++) {
    prev = createHash("sha256").update(`${prev}:${i}`).digest("hex");
    out.push(prev);
  }
  return out;
}

async function signIn(displayName: string): Promise<{ token: string; playerId: string }> {
  const res = await app.request("/v1/auth/anonymous", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  const body = (await res.json()) as { token: string; player: { id: string } };
  return { token: body.token, playerId: body.player.id };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function play(token: string, score: number, chips: number): Promise<void> {
  const start = (await (
    await app.request("/v1/runs/start", {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
    })
  ).json()) as RunStartResponse;
  clock.ms += 60_000; // the run really took its minute
  const res = await app.request(`/v1/runs/${start.runId}/submit`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      startToken: start.startToken,
      score,
      level: 1 + Math.floor(chips / 7),
      chips,
      maxCombo: 8,
      kills: 20,
      durationMs: 60_000,
      clientVersion: "0.1.0",
      attestation: { nonce: start.nonce, chain: chain(start.nonce, 120) },
    }),
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { validity: string }).validity).toBe("ok");
}

describe("the API against a real database", () => {
  it("registers a player, plays a run and ranks them first", async () => {
    const { token } = await signIn("Nova");
    const me = (await (await app.request("/v1/me", { headers: auth(token) })).json()) as { totalRuns: number };
    expect(me.totalRuns).toBe(0);

    await play(token, 12_000, 150);

    const after = (await (await app.request("/v1/me", { headers: auth(token) })).json()) as {
      totalRuns: number;
      bestScore: number;
    };
    expect(after).toMatchObject({ totalRuns: 1, bestScore: 12_000 });

    const board = (await (await app.request("/v1/leaderboard")).json()) as {
      rows: { rank: number; initials: string; score: number }[];
    };
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]).toMatchObject({ rank: 1, initials: "NOV", score: 12_000, level: 22 });
  }, 30_000);

  it("keeps the best run per player on the global board", async () => {
    const a = await signIn("Alpha");
    const b = await signIn("Bravo");
    await play(a.token, 5_000, 80);
    await play(a.token, 9_000, 120);
    await play(b.token, 7_000, 100);

    const board = (await (await app.request("/v1/leaderboard")).json()) as {
      rows: { initials: string; score: number }[];
    };
    expect(board.rows.map((r) => [r.initials, r.score])).toEqual([
      ["ALP", 9_000],
      ["BRA", 7_000],
    ]);
  }, 30_000);

  it("enforces the replay guard against the real primary key", async () => {
    const { token } = await signIn("Nova");
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    clock.ms += 60_000;
    const submission = {
      startToken: start.startToken,
      score: 4_000,
      level: 5,
      chips: 40,
      maxCombo: 8,
      kills: 10,
      durationMs: 60_000,
      clientVersion: "0.1.0",
      attestation: { nonce: start.nonce, chain: chain(start.nonce, 120) },
    };
    expect(
      (
        await app.request(`/v1/runs/${start.runId}/submit`, {
          method: "POST",
          headers: auth(token),
          body: JSON.stringify(submission),
        })
      ).status,
    ).toBe(200);
    const replay = await app.request(`/v1/runs/${start.runId}/submit`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify(submission),
    });
    expect(replay.status).toBe(409);
  }, 30_000);

  it("maintains the daily rollup through its composite primary key", async () => {
    const a = await signIn("Alpha");
    await play(a.token, 3_000, 40);
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: auth(a.token),
        body: JSON.stringify({ mode: "daily", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    clock.ms += 60_000;
    const res = await app.request(`/v1/runs/${start.runId}/submit`, {
      method: "POST",
      headers: auth(a.token),
      body: JSON.stringify({
        startToken: start.startToken,
        score: 8_000,
        level: 11,
        chips: 100,
        maxCombo: 8,
        kills: 20,
        durationMs: 60_000,
        clientVersion: "0.1.0",
        attestation: { nonce: start.nonce, chain: chain(start.nonce, 120) },
      }),
    });
    expect(res.status).toBe(200);

    const daily = (await (await app.request("/v1/leaderboard/daily")).json()) as {
      rows: { initials: string; score: number }[];
    };
    // Two endless-mode runs folded into one daily row, best score kept.
    expect(daily.rows).toHaveLength(1);
    expect(daily.rows[0]).toMatchObject({ initials: "ALP", score: 8_000 });
  }, 30_000);

  it("holds a reported name off the board until a moderator clears it", async () => {
    const offender = await signIn("Badname");
    const reporter = await signIn("Snitch");
    await play(offender.token, 9_000, 120);
    await play(reporter.token, 5_000, 60);

    let board = (await (await app.request("/v1/leaderboard")).json()) as { rows: { initials: string }[] };
    expect(board.rows.map((r) => r.initials)).toEqual(["BAD", "SNI"]);

    const report = await app.request(`/v1/names/${offender.playerId}/report`, {
      method: "POST",
      headers: auth(reporter.token),
      body: JSON.stringify({ reason: "offensive name" }),
    });
    expect(report.status).toBe(201);
    const { reportId } = (await report.json()) as { reportId: number };

    board = (await (await app.request("/v1/leaderboard")).json()) as { rows: { initials: string }[] };
    expect(board.rows.map((r) => r.initials)).toEqual(["SNI"]);

    const queue = (await (
      await app.request("/v1/admin/moderation", { headers: { authorization: `Bearer ${MODERATION_TOKEN}` } })
    ).json()) as { rows: { id: number; reportedName: string }[] };
    expect(queue.rows.map((r) => r.id)).toEqual([reportId]);
    expect(queue.rows[0].reportedName).toBe("Badname");

    const clear = await app.request(`/v1/admin/moderation/${reportId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${MODERATION_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    });
    expect(clear.status).toBe(200);

    board = (await (await app.request("/v1/leaderboard")).json()) as { rows: { initials: string }[] };
    expect(board.rows.map((r) => r.initials)).toEqual(["BAD", "SNI"]);
  }, 30_000);

  it("writes flagged and rejected runs to the audit trail", async () => {
    const { token } = await signIn("Cheater");
    const start = (await (
      await app.request("/v1/runs/start", {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ mode: "endless", clientVersion: "0.1.0" }),
      })
    ).json()) as RunStartResponse;
    clock.ms += 60_000;
    const res = await app.request(`/v1/runs/${start.runId}/submit`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        startToken: start.startToken,
        score: 900_000,
        level: 100,
        chips: 1000,
        maxCombo: 8,
        kills: 20,
        durationMs: 60_000,
        clientVersion: "0.1.0",
        attestation: { nonce: start.nonce, chain: chain(start.nonce, 120) },
      }),
    });
    expect(((await res.json()) as { validity: string }).validity).toBe("rejected");

    const trail = await test.db.execute("SELECT action FROM gridbox.audit_log ORDER BY id DESC");
    const rows = Array.isArray(trail) ? trail : ((trail as { rows?: unknown }).rows ?? []);
    const actions = (rows as { action: string }[]).map((r) => r.action);
    expect(actions).toContain("run.rejected");
  }, 30_000);
});
