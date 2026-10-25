import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../core/adapters/memoryStore.js";
import type { KeyValueStore } from "../core/ports/storage.js";
import {
  TOKEN_KEY,
  clearToken,
  clientVersion,
  createApiClient,
  isRetryable,
  readToken,
  type ApiResult,
} from "./apiClient.js";

interface FakeResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Thrown instead of returning — simulates a transport failure. */
  throwOnCall?: boolean;
}

/** Records what was sent and replays a scripted response. */
function fakeFetch(responses: FakeResponse | FakeResponse[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    }
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body:
        init?.body === undefined
          ? undefined
          : JSON.parse(typeof init.body === "string" ? init.body : "null"),
    });
    const next = queue.shift() ?? { status: 500, body: { error: { code: "NO_RESPONSE", message: "no scripted response" } } };
    if (next.throwOnCall) throw new TypeError("Failed to fetch");
    const body = next.body === undefined ? "" : JSON.stringify(next.body);
    return Promise.resolve(
      new Response(body, {
        status: next.status ?? 200,
        headers: { "content-type": "application/json", ...(next.headers ?? {}) },
      }),
    );
  };
  return { impl, calls };
}

const AUTH_BODY = {
  token: "jwt-token-value",
  player: {
    id: "00000000-0000-4000-8000-000000000001",
    displayName: "Tester",
    initials: "TST",
    bestScore: 0,
    totalRuns: 0,
    createdAt: "2026-10-25T00:00:00.000Z",
  },
};

function client(store: KeyValueStore, responses: FakeResponse | FakeResponse[], isOnline = () => true) {
  const { impl, calls } = fakeFetch(responses);
  return { api: createApiClient({ baseUrl: "", fetchImpl: impl, tokenStore: store, isOnline }), calls };
}

describe("session", () => {
  it("stores the token the server issues", async () => {
    const store = createMemoryStore();
    const { api } = client(store, { body: AUTH_BODY });
    const result = await api.createSession("Tester");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.player.displayName).toBe("Tester");
    expect(readToken(store)).toBe("jwt-token-value");
  });

  it("sends no authorization header on session creation", async () => {
    const store = createMemoryStore();
    const { api, calls } = client(store, { body: AUTH_BODY });
    await api.createSession();
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].body).toEqual({});
  });

  it("sends the stored token on authenticated calls", async () => {
    const store = createMemoryStore();
    const { api, calls } = client(store, [
      { body: AUTH_BODY },
      { body: { ...AUTH_BODY.player, displayName: "Renamed" } },
    ]);
    await api.createSession();
    await api.getMe();
    expect(calls[1].headers.authorization).toBe("Bearer jwt-token-value");
  });

  it("does not store a token when the session fails", async () => {
    const store = createMemoryStore();
    const { api } = client(store, { status: 429, body: { error: { code: "RATE_LIMITED", message: "slow down" } } });
    const result = await api.createSession();
    expect(result.ok).toBe(false);
    expect(readToken(store)).toBeNull();
  });

  it("clears the token on reset", () => {
    const store = createMemoryStore();
    store.set(TOKEN_KEY, "stale");
    clearToken(store);
    expect(readToken(store)).toBeNull();
  });
});

describe("run lifecycle", () => {
  const START_BODY = {
    runId: "00000000-0000-4000-8000-0000000000aa",
    seed: 12345,
    nonce: "server-nonce",
    mode: "endless",
    day: "2026-10-25",
    startToken: "start-token",
  };

  it("asks the server to start the run", async () => {
    const { api, calls } = client(createMemoryStore(), { body: START_BODY });
    const result = await api.startRun("endless");
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe("/v1/runs/start");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ mode: "endless" });
  });

  it("adds the client version the caller left out", async () => {
    const { api, calls } = client(createMemoryStore(), { body: { accepted: true, validity: "ok", rank: 1, bestScore: 10 } });
    await api.submitRun(START_BODY.runId, {
      startToken: START_BODY.startToken,
      score: 10,
      level: 2,
      chips: 7,
      maxCombo: 3,
      kills: 4,
      durationMs: 5000,
      attestation: { nonce: START_BODY.nonce, chain: ["a".repeat(64)] },
    });
    expect(calls[0].body).toMatchObject({ clientVersion: clientVersion() });
    expect(calls[0].url).toBe(`/v1/runs/${START_BODY.runId}/submit`);
  });

  it("returns the parsed submit response", async () => {
    const body = { accepted: true, validity: "ok", rank: 3, bestScore: 900 };
    const { api } = client(createMemoryStore(), { body });
    const result = await api.submitRun("r", {
      startToken: "t",
      score: 900,
      level: 9,
      chips: 60,
      maxCombo: 4,
      kills: 20,
      durationMs: 60_000,
      attestation: { nonce: "n", chain: ["b".repeat(64)] },
    });
    expect(result).toEqual({ ok: true, data: body });
  });
});

describe("leaderboards", () => {
  it("requests the global board with mode and limit", async () => {
    const { api, calls } = client(createMemoryStore(), { body: { scope: "global", mode: "endless", day: null, rows: [] } });
    await api.globalBoard("endless", 50);
    expect(calls[0].url).toBe("/v1/leaderboard?mode=endless&limit=50");
  });

  it("requests the daily board, with the day only when given", async () => {
    const { api, calls } = client(createMemoryStore(), { body: { scope: "daily", mode: "daily", day: "2026-10-25", rows: [] } });
    await api.dailyBoard("daily");
    expect(calls[0].url).toBe("/v1/leaderboard/daily?mode=daily&limit=20");

    await api.dailyBoard("daily", 10, "2026-10-01");
    expect(calls[1].url).toBe("/v1/leaderboard/daily?mode=daily&limit=10&day=2026-10-01");
  });

  it("url-encodes a hostile mode value instead of injecting it", async () => {
    const { api, calls } = client(createMemoryStore(), { body: { scope: "global", mode: "endless", day: null, rows: [] } });
    await api.globalBoard("endless&limit=999" as never);
    expect(calls[0].url).toBe("/v1/leaderboard?mode=endless%26limit%3D999&limit=20");
  });
});

describe("legacy migration", () => {
  const ENTRY = { id: "local-1", score: 100, level: 2, chips: 7, maxCombo: 2, date: 1_700_000_000_000 };

  it("posts the batch and returns the server's tally", async () => {
    const body = { migrated: 1, duplicates: 0, bestScore: 100, totalRuns: 1 };
    const { api, calls } = client(createMemoryStore(), { body });
    const result = await api.migrateScores([ENTRY]);
    expect(result).toEqual({ ok: true, data: body });
    expect(calls[0].url).toBe("/v1/me/migrate-scores");
    expect(calls[0].body).toEqual({ entries: [ENTRY] });
  });

  it("reports the migration status", async () => {
    const { api, calls } = client(createMemoryStore(), { body: { migrated: true } });
    const result = await api.migrationStatus();
    expect(result).toEqual({ ok: true, data: { migrated: true } });
    expect(calls[0].url).toBe("/v1/me/migration-status");
  });
});

describe("error classification", () => {
  async function failure(response: FakeResponse): Promise<ApiResult<unknown>> {
    const { api } = client(createMemoryStore(), response);
    return api.getMe();
  }

  it("passes through the server's code and message", async () => {
    const result = await failure({ status: 400, body: { error: { code: "VALIDATION_FAILED", message: "bad input" } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "VALIDATION_FAILED", message: "bad input", status: 400, retryable: false });
  });

  it("marks 429 retryable and carries the Retry-After delay", async () => {
    const result = await failure({
      status: 429,
      headers: { "retry-after": "30" },
      body: { error: { code: "RATE_LIMITED", message: "slow down" } },
    });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.retryable).toBe(true);
    expect(result.error.retryAfterMs).toBe(30_000);
    expect(isRetryable(result.error)).toBe(true);
  });

  it("marks 5xx retryable", async () => {
    const result = await failure({ status: 503, body: { error: { code: "UNAVAILABLE", message: "later" } } });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.retryable).toBe(true);
  });

  it("marks a 4xx not retryable", async () => {
    const result = await failure({ status: 404, body: { error: { code: "NOT_FOUND", message: "gone" } } });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.retryable).toBe(false);
  });

  it("marks 408 retryable", async () => {
    const result = await failure({ status: 408, body: {} });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.retryable).toBe(true);
  });

  it("keeps the server's request id for log correlation", async () => {
    const { api } = client(createMemoryStore(), {
      status: 500,
      headers: { "x-request-id": "req-123" },
      body: { error: { code: "INTERNAL", message: "boom" } },
    });
    const result = await api.getMe();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.requestId).toBe("req-123");
  });

  it("falls back to a status-derived code when the body is not JSON", async () => {
    const { api } = client(createMemoryStore(), {
      status: 502,
      headers: { "content-type": "text/html" },
      body: undefined,
    });
    // A proxy's HTML error page arrives as a non-JSON body.
    const impl = ((): Promise<Response> =>
      Promise.resolve(
        new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
      )) as unknown as typeof fetch;
    const api2 = createApiClient({ fetchImpl: impl, tokenStore: createMemoryStore() });
    const result = await api2.getMe();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("HTTP_502");
    expect(result.error.retryable).toBe(true);
    void api;
  });

  it("ignores a nonsensical Retry-After", async () => {
    const result = await failure({ status: 429, headers: { "retry-after": "soon" }, body: {} });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.retryAfterMs).toBeUndefined();
  });
});

describe("transport failures", () => {
  it("reports a thrown fetch as a retryable network error", async () => {
    const { api } = client(createMemoryStore(), { throwOnCall: true });
    const result = await api.getMe();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("NETWORK");
    expect(result.error.retryable).toBe(true);
  });

  it("short-circuits when the browser is offline", async () => {
    const store = createMemoryStore();
    const { api, calls } = client(store, { body: AUTH_BODY }, () => false);
    const result = await api.getMe();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("OFFLINE");
    expect(result.error.retryable).toBe(true);
    // The expensive part: no request was even attempted.
    expect(calls).toHaveLength(0);
  });

  it("treats a bodyless 204 as a protocol surprise, not silent success", async () => {
    // Every endpoint in this API returns JSON. A 204 means a proxy stripped the
    // body or a route is misconfigured, and handing the caller `undefined`
    // would turn that into a confusing crash much later.
    const impl = ((): Promise<Response> =>
      Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch;
    const api = createApiClient({ fetchImpl: impl, tokenStore: createMemoryStore() });
    const result = await api.getMe();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("EMPTY_BODY");
  });

  it("reports an empty body on a 200 as malformed", async () => {
    const impl = ((): Promise<Response> =>
      Promise.resolve(new Response("", { status: 200 }))) as unknown as typeof fetch;
    const api = createApiClient({ fetchImpl: impl, tokenStore: createMemoryStore() });
    const result = await api.getMe();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("EMPTY_BODY");
    expect(result.error.retryable).toBe(false);
  });

  it("reports a non-JSON body on a 200 as malformed", async () => {
    const impl = ((): Promise<Response> =>
      Promise.resolve(new Response("not json", { status: 200 }))) as unknown as typeof fetch;
    const api = createApiClient({ fetchImpl: impl, tokenStore: createMemoryStore() });
    const result = await api.getMe();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });
});

describe("wiring", () => {
  it("sends the client version header on every call", async () => {
    const { api, calls } = client(createMemoryStore(), { body: AUTH_BODY });
    await api.createSession();
    expect(calls[0].headers["x-client-version"]).toBe(clientVersion());
  });

  it("honours a custom base url", async () => {
    const { impl, calls } = fakeFetch({ body: AUTH_BODY });
    const api = createApiClient({ baseUrl: "https://api.example", fetchImpl: impl, tokenStore: createMemoryStore() });
    await api.createSession();
    expect(calls[0].url).toBe("https://api.example/v1/auth/anonymous");
  });

  it("never throws, whatever the server does", async () => {
    const horrors: FakeResponse[] = [
      { status: 500, body: null },
      { status: 200, body: undefined },
      { status: 200, body: "a string, not an object" },
      { status: 401, body: { error: null } },
    ];
    for (const horror of horrors) {
      const { api } = client(createMemoryStore(), horror);
      await expect(api.getMe()).resolves.toBeDefined();
    }
  });

  it("a spy on fetch sees exactly one call per operation", async () => {
    const spy = vi.fn((): Promise<Response> => Promise.resolve(new Response(JSON.stringify(AUTH_BODY), { status: 200 })));
    const api = createApiClient({ fetchImpl: spy as unknown as typeof fetch, tokenStore: createMemoryStore() });
    await api.createSession();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
