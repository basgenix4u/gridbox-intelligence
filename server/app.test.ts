import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Env } from "./env";

/**
 * The app is constructed directly rather than through the Vercel handler, so
 * these tests exercise the real routing, middleware and error handling without
 * needing a running server or a database.
 */
const baseEnv: Env = {
  NODE_ENV: "test",
  ALLOWED_ORIGINS: "*",
  MIN_CLIENT_VERSION: "0.0.0",
  COMMIT_SHA: "test-sha",
  SERVICE_VERSION: "1.2.3",
  DATABASE_URL: undefined,
  DIRECT_URL: undefined,
  AUTH_SECRET: undefined,
  RATE_LIMIT_REDIS_URL: undefined,
  RATE_LIMIT_REDIS_TOKEN: undefined,
};

describe("GET /v1/healthz", () => {
  it("reports ok without touching the database", async () => {
    const app = createApp({ env: baseEnv, envSource: { NODE_ENV: "test" }, db: null });
    const res = await app.request("/v1/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.version).toBe("1.2.3");
    expect(body.commit).toBe("test-sha");
    expect(body.environment).toBe("test");
  });

  it("reports a monotonic uptime", async () => {
    const app = createApp({ env: baseEnv, envSource: { NODE_ENV: "test" }, db: null, startedAt: Date.now() - 5_000 });
    const body = (await (await app.request("/v1/healthz")).json()) as { uptimeMs: number };
    expect(body.uptimeMs).toBeGreaterThanOrEqual(5_000);
  });
});

describe("GET /v1/readyz", () => {
  it("is degraded when no database is configured", async () => {
    const app = createApp({ env: baseEnv, envSource: { NODE_ENV: "test" }, db: null });
    const res = await app.request("/v1/readyz");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; problems: string[] };
    expect(body.status).toBe("degraded");
    expect(body.problems.join(" ")).toContain("DATABASE_URL");
  });

  it("is ready when the database answers", async () => {
    const fakeDb = { execute: () => Promise.resolve([]) } as never;
    const app = createApp({
      env: { ...baseEnv, DATABASE_URL: "postgresql://localhost:5432/x" },
      envSource: { NODE_ENV: "test" },
      db: fakeDb,
    });
    const res = await app.request("/v1/readyz");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ready");
  });

  it("is degraded and names the failure when the database is unreachable", async () => {
    const brokenDb = { execute: () => Promise.reject(new Error("ECONNREFUSED")) } as never;
    const app = createApp({
      env: { ...baseEnv, DATABASE_URL: "postgresql://localhost:5432/x" },
      envSource: { NODE_ENV: "test" },
      db: brokenDb,
    });
    const res = await app.request("/v1/readyz");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { problems: string[] };
    expect(body.problems.join(" ")).toContain("connection failed");
  });

  it("surfaces invalid configuration instead of silently starting", async () => {
    const app = createApp({
      env: baseEnv,
      envSource: { NODE_ENV: "test", AUTH_SECRET: "too-short" },
      db: { execute: () => Promise.resolve([]) } as never,
    });
    const res = await app.request("/v1/readyz");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { problems: string[] };
    expect(body.problems.join(" ")).toContain("AUTH_SECRET");
  });
});

describe("base path", () => {
  it("serves the routes under an /api prefix, as Vercel invokes them", async () => {
    const app = createApp({ env: baseEnv, envSource: { NODE_ENV: "test" }, db: null, basePath: "/api" });
    const res = await app.request("/api/v1/healthz");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
  });

  it("still 404s an unknown path under the prefix", async () => {
    const app = createApp({ env: baseEnv, envSource: { NODE_ENV: "test" }, db: null, basePath: "/api" });
    const res = await app.request("/api/v1/missing");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("does not answer the unprefixed path when a prefix is set", async () => {
    const app = createApp({ env: baseEnv, envSource: { NODE_ENV: "test" }, db: null, basePath: "/api" });
    const res = await app.request("/v1/healthz");
    expect(res.status).toBe(404);
  });
});

describe("request handling", () => {
  it("echoes and generates a request id", async () => {
    const app = createApp({ env: baseEnv, envSource: { NODE_ENV: "test" }, db: null });
    const withHeader = await app.request("/v1/healthz", { headers: { "x-request-id": "abc-123" } });
    expect(withHeader.headers.get("x-request-id")).toBe("abc-123");

    const without = await app.request("/v1/healthz");
    expect(without.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns a structured 404 for an unknown route", async () => {
    const app = createApp({ env: baseEnv, envSource: { NODE_ENV: "test" }, db: null });
    const res = await app.request("/v1/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string; requestId?: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("/v1/does-not-exist");
    expect(body.error.requestId).toBeTruthy();
  });

  it("sets security headers on every response", async () => {
    const app = createApp({ env: baseEnv, envSource: { NODE_ENV: "test" }, db: null });
    const res = await app.request("/v1/healthz");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBeTruthy();
    expect(res.headers.get("referrer-policy")).toBeTruthy();
  });

  it("reflects a specific origin allowlist", async () => {
    const app = createApp({
      env: { ...baseEnv, ALLOWED_ORIGINS: "https://gridbox.example" },
      envSource: { NODE_ENV: "test" },
      db: null,
    });
    const allowed = await app.request("/v1/healthz", { headers: { origin: "https://gridbox.example" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://gridbox.example");
  });
});

describe("route registration", () => {
  /**
   * The production shape: `api/index.ts` calls `createApp()` with no options at
   * all, so the only thing that can wire the database is `DATABASE_URL`. When
   * that branch is missing the game routes are never mounted and the API
   * answers 404 "No route for POST /v1/auth/anonymous" to every real request —
   * `/healthz` and `/readyz` still look perfectly healthy, which is exactly how
   * this bug reached a live deployment unnoticed.
   */
  it("mounts the game routes from DATABASE_URL when no db is injected", async () => {
    const app = createApp({
      env: { ...baseEnv, DATABASE_URL: "postgresql://gridbox:secret@127.0.0.1:5432/gridbox" },
      envSource: { NODE_ENV: "test" },
    });
    const res = await app.request("/v1/auth/anonymous", { method: "POST" });
    // Not 404-with-"No route": the route exists. It fails later, on the
    // connection attempt, because nothing is listening on 127.0.0.1:5432.
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message ?? "").not.toContain("No route for");
    expect(res.status).not.toBe(404);
  });

  it("keeps health routes available with no database at all", async () => {
    const app = createApp({ env: baseEnv, envSource: { NODE_ENV: "test" }, db: null });
    const res = await app.request("/v1/healthz");
    expect(res.status).toBe(200);
  });

  it("an injected null db still means no game routes", async () => {
    const app = createApp({
      env: { ...baseEnv, DATABASE_URL: "postgresql://gridbox:secret@127.0.0.1:5432/gridbox" },
      envSource: { NODE_ENV: "test" },
      db: null,
    });
    const res = await app.request("/v1/auth/anonymous", { method: "POST" });
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message ?? "").toContain("No route for");
  });
});
