// @vitest-environment jsdom

/**
 * useSession (task 4.1b).
 *
 * The interesting behaviour is all about failure tolerance: the session is an
 * optimisation, never a prerequisite for play. A dead token, an unreachable
 * server and a rejected fetch all end in `failed` with `player === null`, and
 * the game still runs. These tests also pin the legacy-migration trigger,
 * because that is the half of task 3.13 that was missing.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../core/adapters/memoryStore.js";
import type { KeyValueStore } from "../core/ports/storage.js";
import type { AuthResponse, Player } from "../shared/contracts.js";
import { TOKEN_KEY } from "./apiClient.js";
import { useSession } from "./useSession.js";

const PLAYER: Player = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Gridlock",
  initials: "GRI",
  bestScore: 0,
  totalRuns: 0,
  createdAt: "2026-10-25T00:00:00.000Z",
};

const AUTH: AuthResponse = { token: "jwt-1", player: PLAYER };

/** A minimal stand-in for GameApiClient: only what useSession calls. */
function scriptedClient(
  script: {
    getMe?: () => Promise<unknown>;
    createSession?: () => Promise<unknown>;
    updateMe?: () => Promise<unknown>;
  } = {},
) {
  return {
    createSession: script.createSession ?? (() => Promise.resolve({ ok: true, data: AUTH })),
    getMe: script.getMe ?? (() => Promise.resolve({ ok: true, data: PLAYER })),
    updateMe: script.updateMe ?? (() => Promise.resolve({ ok: true, data: PLAYER })),
  } as never;
}

/**
 * Drains the microtask *and* macrotask queues. `await Promise.resolve()` only
 * advances one turn, and both the session and the migration are chains of
 * several awaits — one turn leaves the hook mid-flight.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Seeds the local score table the migration uploads. `date` must be a number —
 * `parseEntry` rejects an ISO string, which would silently read back as "no
 * scores" rather than as a parse error.
 */
function seedScores(store: KeyValueStore): void {
  store.set(
    "gridbox-intelligence.scores.v1",
    JSON.stringify([
      {
        id: "legacy-1",
        name: "Returner",
        score: 4200,
        level: 3,
        chips: 18,
        maxCombo: 4,
        date: 1_700_000_000_000,
        scoringVersion: 1,
      },
    ]),
  );
}

describe("useSession", () => {
  let store: KeyValueStore;

  beforeEach(() => {
    store = createMemoryStore();
  });

  it("creates an anonymous session on mount when there is no token", async () => {
    const createSession = vi.fn(() => Promise.resolve({ ok: true, data: AUTH }));
    const client = scriptedClient({ createSession });

    const { result } = renderHook(() => useSession({ client, store }));
    await flush();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
    expect(result.current.player).toEqual(PLAYER);
    expect(result.current.authenticated).toBe(true);
  });

  it("resumes a stored token instead of minting a second player", async () => {
    store.set(TOKEN_KEY, "jwt-old");
    const createSession = vi.fn(() => Promise.resolve({ ok: true, data: AUTH }));
    const getMe = vi.fn(() => Promise.resolve({ ok: true, data: PLAYER }));
    const client = scriptedClient({ createSession, getMe });

    const { result } = renderHook(() => useSession({ client, store }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(getMe).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
    expect(result.current.status).toBe("ready");
    expect(store.get(TOKEN_KEY)).toBe("jwt-old");
  });

  it("drops a dead token and re-creates the session", async () => {
    store.set(TOKEN_KEY, "jwt-dead");
    const createSession = vi.fn(() => Promise.resolve({ ok: true, data: AUTH }));
    // 401: the server says this token will never work again.
    const getMe = vi.fn(() =>
      Promise.resolve({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "bad token", retryable: false },
      }),
    );
    const client = scriptedClient({ createSession, getMe });

    const { result } = renderHook(() => useSession({ client, store }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(store.get(TOKEN_KEY)).not.toBe("jwt-dead");
    expect(result.current.status).toBe("ready");
  });

  it("keeps a retryable token and still reports the failure", async () => {
    store.set(TOKEN_KEY, "jwt-stale");
    const getMe = vi.fn(() =>
      Promise.resolve({
        ok: false,
        error: { code: "SERVER", message: "boom", retryable: true },
      }),
    );
    const client = scriptedClient({ getMe });

    const { result } = renderHook(() => useSession({ client, store }));
    await act(async () => {
      await Promise.resolve();
    });

    // Not dropped: a 503 says nothing about the token, only about the server.
    expect(store.get(TOKEN_KEY)).toBe("jwt-stale");
    expect(result.current.status).toBe("failed");
    expect(result.current.player).toBeNull();
  });

  it("stays playable when the server is unreachable", async () => {
    const getMe = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const createSession = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const client = scriptedClient({ getMe, createSession });

    const { result } = renderHook(() => useSession({ client, store }));
    await act(async () => {
      await Promise.resolve();
    });

    // The game must not be blocked by this — that is the whole design.
    expect(result.current.status).toBe("failed");
    expect(result.current.authenticated).toBe(false);
    expect(result.current.player).toBeNull();
    expect(result.current.error?.retryable).toBe(true);
  });

  it("renames and clears a previous rename error", async () => {
    const client = scriptedClient({
      updateMe: () => Promise.resolve({ ok: true, data: { ...PLAYER, displayName: "Newname" } }),
    });

    const { result } = renderHook(() => useSession({ client, store }));
    await act(async () => {
      await Promise.resolve();
    });

    let ok = false;
    await act(async () => {
      ok = await result.current.rename({ displayName: "Newname" });
    });

    expect(ok).toBe(true);
    expect(result.current.player?.displayName).toBe("Newname");
    expect(result.current.renameError).toBeNull();
  });

  it("surfaces a rename failure without touching the player", async () => {
    const client = scriptedClient({
      updateMe: () =>
        Promise.resolve({
          ok: false,
          error: { code: "RATE_LIMITED", message: "slow down", retryable: true },
        }),
    });

    const { result } = renderHook(() => useSession({ client, store }));
    await act(async () => {
      await Promise.resolve();
    });

    let ok = true;
    await act(async () => {
      ok = await result.current.rename({ displayName: "Taken" });
    });

    expect(ok).toBe(false);
    expect(result.current.renameError?.message).toBe("slow down");
  });

  it("reset forgets the session but keeps the player until the next attempt", async () => {
    const client = scriptedClient();
    const { result } = renderHook(() => useSession({ client, store }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.reset();
    });

    expect(store.get(TOKEN_KEY)).toBeNull();
    expect(result.current.status).toBe("idle");
    expect(result.current.player).toBeNull();
  });
});

describe("useSession — legacy migration trigger (task 3.13)", () => {
  let store: KeyValueStore;

  beforeEach(() => {
    store = createMemoryStore();
  });

  /** A 200 from the migration endpoint, recording what it was sent. */
  function migrationServer(body: unknown = { migrated: 1, duplicates: 0, bestScore: 4200, totalRuns: 1 }) {
    const sent: { url: string; auth: string | null; body: unknown }[] = [];
    const fetchImpl = vi.fn((input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      sent.push({
        url: String(input),
        auth: headers.authorization ?? null,
        body:
          init?.body === undefined
            ? undefined
            : JSON.parse(typeof init.body === "string" ? init.body : "null"),
      });
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    return { fetchImpl, sent };
  }

  it("uploads the local history when the player sets a username", async () => {
    seedScores(store);
    store.set(TOKEN_KEY, "jwt-1");
    const { fetchImpl, sent } = migrationServer();
    const client = scriptedClient();

    const { result } = renderHook(() => useSession({ client, store, fetchImpl }));
    await flush();

    let ok = false;
    await act(async () => {
      ok = await result.current.rename({ displayName: "Gridlock" });
    });
    // The migration runs after the rename resolves; let its promise settle.
    await flush();

    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sent[0]?.url).toBe("/v1/me/migrate-scores");
    expect(sent[0]?.auth).toBe("Bearer jwt-1");
    expect(sent[0]?.body).toEqual({
      entries: [
        {
          id: "legacy-1",
          score: 4200,
          level: 3,
          chips: 18,
          maxCombo: 4,
          date: 1_700_000_000_000,
          scoringVersion: 1,
        },
      ],
    });
    expect(result.current.migration).toEqual({
      status: "done",
      outcome: { status: "migrated", migrated: 1, duplicates: 0 },
    });
  });

  it("does not migrate when only the initials change", async () => {
    seedScores(store);
    store.set(TOKEN_KEY, "jwt-1");
    const { fetchImpl } = migrationServer();
    const client = scriptedClient();

    const { result } = renderHook(() => useSession({ client, store, fetchImpl }));
    await flush();

    await act(async () => {
      await result.current.rename({ initials: "XYZ" });
    });

    // Setting a *username* is what makes the player identifiable; changing
    // initials is not, and re-uploading would be noise.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.migration).toEqual({ status: "idle" });
  });

  it("keeps the migration one-shot — a second rename does not re-upload", async () => {
    seedScores(store);
    store.set(TOKEN_KEY, "jwt-1");
    const { fetchImpl } = migrationServer();
    const client = scriptedClient();

    const { result } = renderHook(() => useSession({ client, store, fetchImpl }));
    await flush();

    await act(async () => {
      await result.current.rename({ displayName: "Gridlock" });
    });
    await flush();
    await act(async () => {
      await result.current.rename({ displayName: "Gridlock Two" });
    });
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a migration failure without failing the rename", async () => {
    seedScores(store);
    store.set(TOKEN_KEY, "jwt-1");
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const client = scriptedClient({
      updateMe: () => Promise.resolve({ ok: true, data: PLAYER }),
    });

    const { result } = renderHook(() => useSession({ client, store, fetchImpl }));
    await flush();

    let ok = false;
    await act(async () => {
      ok = await result.current.rename({ displayName: "Gridlock" });
    });
    await flush();

    // The rename is the user's intent; the migration is housekeeping. A failed
    // upload must never turn a successful rename into a visible error.
    expect(ok).toBe(true);
    expect(result.current.player).toEqual(PLAYER);
    expect(result.current.renameError).toBeNull();
    expect(result.current.migration).toEqual({
      status: "done",
      outcome: { status: "failed", reason: "Failed to fetch" },
    });
    // The flag stays unset, so the next rename retries.
    expect(store.get("gridbox-intelligence.scores.migrated.v1")).toBeNull();
  });

  it("skips silently when there is no session to migrate into", async () => {
    seedScores(store);
    const { fetchImpl } = migrationServer();
    const client = scriptedClient();

    const { result } = renderHook(() => useSession({ client, store, fetchImpl }));
    await flush();

    await act(async () => {
      await result.current.rename({ displayName: "Gridlock" });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.migration).toEqual({
      status: "done",
      outcome: { status: "skipped", reason: "no-session" },
    });
  });
});
