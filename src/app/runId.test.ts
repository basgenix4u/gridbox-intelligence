// @vitest-environment jsdom

/**
 * runId (task 4.1).
 *
 * The only thing that matters is that two runs never collide, including on a
 * non-secure context where `crypto.randomUUID` is missing.
 */

import { describe, expect, it, vi } from "vitest";
import { createRunId } from "./runId.js";

describe("createRunId", () => {
  it("returns a uuid where the platform provides one", () => {
    const id = createRunId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("does not collide across many calls", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createRunId()));
    expect(ids.size).toBe(500);
  });

  it("falls back to a timestamp where randomUUID is unavailable", () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: () => new Uint32Array(1) });
    try {
      const id = createRunId();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      expect(id).not.toContain("undefined");
    } finally {
      vi.stubGlobal("crypto", original);
      vi.unstubAllGlobals();
    }
  });
});
