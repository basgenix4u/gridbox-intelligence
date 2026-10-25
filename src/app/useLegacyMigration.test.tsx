// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createMemoryStore } from "../core/adapters/memoryStore.js";
import { useLegacyMigration } from "./useLegacyMigration.js";

/** A pre-server entry. `name` is required by the local table's own validator. */
const ENTRY = {
  id: "local-1",
  name: "Returner",
  score: 500,
  level: 3,
  chips: 20,
  maxCombo: 2,
  date: 1_700_000_000_000,
  scoringVersion: 1,
};

/** Writes a local score table so there is something to upload. */
function seedScores(store: ReturnType<typeof createMemoryStore>): void {
  store.set(
    "gridbox-intelligence.scores.v1",
    JSON.stringify([{ ...ENTRY, scoringVersion: 1 }]),
  );
}

function fetchReturning(status: number, body: unknown) {
  return vi.fn((): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe("useLegacyMigration", () => {
  it("starts idle and never touches the network", () => {
    const store = createMemoryStore();
    const fetchImpl = fetchReturning(200, { migrated: 1, duplicates: 0, bestScore: 500, totalRuns: 1 });
    const { result } = renderHook(() => useLegacyMigration({ token: "t", store, fetchImpl }));

    expect(result.current.state.status).toBe("idle");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uploads the local history once the player has a session", async () => {
    const store = createMemoryStore();
    seedScores(store);
    const fetchImpl = fetchReturning(200, { migrated: 1, duplicates: 0, bestScore: 500, totalRuns: 1 });
    const { result } = renderHook(() => useLegacyMigration({ token: "token", store, fetchImpl }));

    let outcome: Awaited<ReturnType<typeof result.current.runMigration>> | undefined;
    await act(async () => {
      outcome = await result.current.runMigration();
    });

    expect(outcome).toEqual({ status: "migrated", migrated: 1, duplicates: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({
      status: "done",
      outcome: { status: "migrated", migrated: 1, duplicates: 0 },
    });
  });

  it("marks the browser as migrated so a reload never re-uploads", async () => {
    const store = createMemoryStore();
    seedScores(store);
    const fetchImpl = fetchReturning(200, { migrated: 1, duplicates: 0, bestScore: 500, totalRuns: 1 });
    const { result } = renderHook(() => useLegacyMigration({ token: "token", store, fetchImpl }));

    await act(async () => {
      await result.current.runMigration();
    });
    expect(store.get("gridbox-intelligence.scores.migrated.v1")).toBe("1");

    await act(async () => {
      await result.current.runMigration();
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a session — nothing to migrate into", async () => {
    const store = createMemoryStore();
    seedScores(store);
    const fetchImpl = fetchReturning(200, {});
    const { result } = renderHook(() => useLegacyMigration({ token: null, store, fetchImpl }));

    let outcome: Awaited<ReturnType<typeof result.current.runMigration>> | undefined;
    await act(async () => {
      outcome = await result.current.runMigration();
    });
    expect(outcome).toEqual({ status: "skipped", reason: "no-session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does nothing when there are no local scores", async () => {
    const store = createMemoryStore();
    const fetchImpl = fetchReturning(200, {});
    const { result } = renderHook(() => useLegacyMigration({ token: "token", store, fetchImpl }));

    let outcome: Awaited<ReturnType<typeof result.current.runMigration>> | undefined;
    await act(async () => {
      outcome = await result.current.runMigration();
    });
    expect(outcome).toEqual({ status: "skipped", reason: "no-scores" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the attempt retryable when the server refuses", async () => {
    const store = createMemoryStore();
    seedScores(store);
    const fetchImpl = fetchReturning(500, { error: { code: "INTERNAL", message: "boom" } });
    const { result } = renderHook(() => useLegacyMigration({ token: "token", store, fetchImpl }));

    let outcome: Awaited<ReturnType<typeof result.current.runMigration>> | undefined;
    await act(async () => {
      outcome = await result.current.runMigration();
    });
    expect(outcome?.status).toBe("failed");
    // The flag is NOT set: a later rename tries again, and the server dedupes.
    expect(store.get("gridbox-intelligence.scores.migrated.v1")).toBeNull();
  });

  it("never rejects, even when fetch throws", async () => {
    const store = createMemoryStore();
    seedScores(store);
    const fetchImpl = vi.fn((): Promise<Response> => Promise.reject(new TypeError("Failed to fetch")));
    const { result } = renderHook(() => useLegacyMigration({ token: "token", store, fetchImpl }));

    let outcome: Awaited<ReturnType<typeof result.current.runMigration>> | undefined;
    await act(async () => {
      outcome = await result.current.runMigration();
    });
    expect(outcome).toEqual({ status: "failed", reason: "Failed to fetch" });
    expect(result.current.state.status).toBe("done");
  });

  it("does not race two concurrent calls", async () => {
    const store = createMemoryStore();
    seedScores(store);
    let release = (): void => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetchImpl = vi.fn((): Promise<Response> =>
      gate.then(
        () => new Response(JSON.stringify({ migrated: 1, duplicates: 0, bestScore: 500, totalRuns: 1 }), { status: 200 }),
      ),
    );
    const { result } = renderHook(() => useLegacyMigration({ token: "token", store, fetchImpl }));

    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    act(() => {
      first = result.current.runMigration();
      second = result.current.runMigration();
    });
    release();
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports duplicates when the same batch is replayed after a lost flag", async () => {
    const store = createMemoryStore();
    seedScores(store);
    const fetchImpl = fetchReturning(200, { migrated: 0, duplicates: 1, bestScore: 500, totalRuns: 1 });
    const { result } = renderHook(() => useLegacyMigration({ token: "token", store, fetchImpl }));

    let outcome: Awaited<ReturnType<typeof result.current.runMigration>> | undefined;
    await act(async () => {
      outcome = await result.current.runMigration();
    });
    expect(outcome).toEqual({ status: "migrated", migrated: 0, duplicates: 1 });
  });
});
