import { describe, expect, it } from "vitest";

import { stripApiPrefix } from "./index";

describe("stripApiPrefix", () => {
  it("removes the /api prefix Vercel leaves on rewritten requests", () => {
    expect(stripApiPrefix(new URL("https://x.dev/api/v1/healthz")).pathname).toBe("/v1/healthz");
  });

  it("preserves the query string", () => {
    const url = stripApiPrefix(new URL("https://x.dev/api/v1/scores?mode=blitz&limit=10"));
    expect(url.pathname).toBe("/v1/scores");
    expect(url.search).toBe("?mode=blitz&limit=10");
  });

  it("collapses a bare /api to /", () => {
    expect(stripApiPrefix(new URL("https://x.dev/api")).pathname).toBe("/");
  });

  it("leaves unprefixed paths untouched", () => {
    expect(stripApiPrefix(new URL("https://x.dev/v1/healthz")).pathname).toBe("/v1/healthz");
  });
});
