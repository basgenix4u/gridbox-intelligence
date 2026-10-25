// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVerifiedRun } from "./useVerifiedRun.js";
import { createApiClient, type GameApiClient } from "./apiClient.js";
import { createMemoryStore } from "../core/adapters/memoryStore.js";

const RUN_ID = "00000000-0000-4000-8000-0000000000aa";
const START_BODY = {
  runId: RUN_ID,
  seed: 987654321,
  nonce: "server-issued-nonce",
  mode: "endless" as const,
  day: "2026-10-25",
  startToken: "start-token",
};
const SUBMIT_BODY = { accepted: true, validity: "ok" as const, rank: 1, bestScore: 900 };

/** A client whose responses are scripted per call. */
function scriptedClient(bodies: { ok: boolean; data?: unknown; error?: unknown }[]): GameApiClient {
  let i = 0;
  const next = (): { ok: boolean; data?: unknown; error?: unknown } => bodies[Math.min(i++, bodies.length - 1)];
  // `Promise.resolve` rather than `async`: these are scripted, not awaited, so
  // an `async` keyword would only trip require-await.
  return {
    createSession: () => Promise.resolve(next()) as never,
    getMe: () => Promise.resolve(next()) as never,
    updateMe: () => Promise.resolve(next()) as never,
    startRun: () => Promise.resolve(next()) as never,
    submitRun: () => Promise.resolve(next()) as never,
    globalBoard: () => Promise.resolve(next()) as never,
    dailyBoard: () => Promise.resolve(next()) as never,
    migrateScores: () => Promise.resolve(next()) as never,
    migrationStatus: () => Promise.resolve(next()) as never,
  };
}

const OUTCOME = { score: 900, level: 9, chips: 60, maxCombo: 4, kills: 20, durationMs: 12_000 };

function setup(bodies: { ok: boolean; data?: unknown; error?: unknown }[]) {
  const onFallback = vi.fn();
  const onSubmitted = vi.fn();
  const client = scriptedClient(bodies);
  const view = renderHook(() => useVerifiedRun({ client, onFallback, onSubmitted }));
  return { ...view, onFallback, onSubmitted };
}

describe("useVerifiedRun", () => {
  it("starts idle", () => {
    const { result } = setup([{ ok: true, data: START_BODY }]);
    expect(result.current.phase).toEqual({ status: "idle" });
  });

  it("moves to playing with the server's seed and nonce", async () => {
    const { result } = setup([{ ok: true, data: START_BODY }]);
    let started: unknown;
    await act(async () => {
      started = await result.current.startRun("endless");
    });
    expect(started).toEqual(START_BODY);
    expect(result.current.phase.status).toBe("playing");
    if (result.current.phase.status !== "playing") throw new Error("expected playing");
    expect(result.current.phase.run.seed).toBe(987654321);
    expect(result.current.phase.attestor.length).toBe(0);
  });

  it("accumulates attestation links while playing", async () => {
    const { result } = setup([{ ok: true, data: START_BODY }]);
    await act(async () => {
      await result.current.startRun("endless");
    });
    act(() => {
      for (let i = 0; i < 4; i++) result.current.attest(i * 500);
    });
    if (result.current.phase.status !== "playing") throw new Error("expected playing");
    expect(result.current.phase.attestor.length).toBe(4);
  });

  it("submits with the attestation chain and reports the rank", async () => {
    const { result, onSubmitted } = setup([
      { ok: true, data: START_BODY },
      { ok: true, data: SUBMIT_BODY },
    ]);
    await act(async () => {
      await result.current.startRun("endless");
      for (let i = 0; i < 6; i++) result.current.attest(i * 500);
    });
    let submitted: unknown;
    await act(async () => {
      submitted = await result.current.finishRun(OUTCOME);
    });

    expect(submitted).toEqual(SUBMIT_BODY);
    expect(result.current.phase).toEqual({ status: "submitted", result: SUBMIT_BODY });
    expect(onSubmitted).toHaveBeenCalledWith(SUBMIT_BODY);
  });

  it("falls back to a local run when the server will not start one", async () => {
    const { result, onFallback } = setup([
      { ok: false, error: { code: "OFFLINE", message: "No connection", retryable: true } },
    ]);
    let started: unknown = "unset";
    await act(async () => {
      started = await result.current.startRun("endless");
    });

    expect(started).toBeNull();
    // Offline is reported as such, so the UI can say "offline" rather than
    // blaming the server.
    expect(onFallback).toHaveBeenCalledWith("offline");
    expect(result.current.phase).toEqual({ status: "local-only", reason: "offline" });
  });

  it("does not submit a run that never started", async () => {
    const { result, onFallback } = setup([
      { ok: false, error: { code: "RATE_LIMITED", message: "slow down", retryable: true } },
      { ok: true, data: SUBMIT_BODY },
    ]);
    await act(async () => {
      await result.current.startRun("endless");
    });
    let submitted: unknown = "unset";
    await act(async () => {
      submitted = await result.current.finishRun(OUTCOME);
    });
    expect(submitted).toBeNull();
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("keeps the run local when the submit fails — the score is not lost", async () => {
    const { result, onSubmitted } = setup([
      { ok: true, data: START_BODY },
      { ok: false, error: { code: "NETWORK", message: "Failed to fetch", retryable: true } },
    ]);
    await act(async () => {
      await result.current.startRun("endless");
    });
    let submitted: unknown = "unset";
    await act(async () => {
      submitted = await result.current.finishRun(OUTCOME);
    });

    expect(submitted).toBeNull();
    expect(result.current.phase).toEqual({ status: "local-only", reason: "Failed to fetch" });
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("reset returns to idle", async () => {
    const { result } = setup([{ ok: true, data: START_BODY }]);
    await act(async () => {
      await result.current.startRun("endless");
    });
    act(() => result.current.reset());
    expect(result.current.phase).toEqual({ status: "idle" });
  });

  it("attest is a no-op before a run starts", () => {
    const { result } = setup([{ ok: true, data: START_BODY }]);
    expect(() => result.current.attest(0)).not.toThrow();
  });

  it("uses the real client against a scripted server end to end", async () => {
    // The same flow the browser performs, against a fake transport: this is
    // the test that would catch a drift between client and contract.
    const store = createMemoryStore();
    let call = 0;
    const fetchImpl = vi.fn((): Promise<Response> => {
      call += 1;
      const body = call === 1 ? START_BODY : SUBMIT_BODY;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    });
    const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch, tokenStore: store });
    const view = renderHook(() => useVerifiedRun({ client }));

    await act(async () => {
      await view.result.current.startRun("endless");
      for (let i = 0; i < 3; i++) view.result.current.attest(i * 500);
    });
    await act(async () => {
      await view.result.current.finishRun(OUTCOME);
    });

    expect(view.result.current.phase.status).toBe("submitted");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const submitInit = (fetchImpl.mock.calls[1] as unknown[])[1] as { body?: string };
    const submitBody = submitInit.body ?? "";
    const submitCall = JSON.parse(submitBody) as {
      attestation: { nonce: string; chain: string[] };
      clientVersion: string;
    };
    expect(submitCall.attestation.chain).toHaveLength(3);
    expect(submitCall.attestation.nonce).toBe(START_BODY.nonce);
    expect(submitCall.clientVersion).toBe("0.1.0");
  });
});
