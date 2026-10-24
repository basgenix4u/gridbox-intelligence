import { describe, expect, it } from "vitest";
import { readEnv } from "./env.js";

/** A production-shaped environment that passes every invariant. */
const PROD_OK = {
  NODE_ENV: "production",
  AUTH_SECRET: "prod-secret-0123456789abcdef0123456789abcdef",
  ALLOWED_ORIGINS: "https://gridbox-intelligence.vercel.app",
  DATABASE_URL: "postgres://user:pass@db.example.com:6543/postgres",
};

describe("readEnv", () => {
  it("boots development with permissive defaults", () => {
    const result = readEnv({ NODE_ENV: "development" });
    expect(result.ok).toBe(true);
    expect(result.env.ALLOWED_ORIGINS).toBeUndefined();
    expect(result.errors).toEqual([]);
  });

  it("accepts an explicit production allowlist", () => {
    const result = readEnv(PROD_OK);
    expect(result.ok).toBe(true);
    expect(result.env.ALLOWED_ORIGINS).toBe("https://gridbox-intelligence.vercel.app");
  });

  it("rejects production without an allowlist", () => {
    const result = readEnv({ ...PROD_OK, ALLOWED_ORIGINS: undefined });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("ALLOWED_ORIGINS");
  });

  it("rejects a wildcard production allowlist", () => {
    const result = readEnv({ ...PROD_OK, ALLOWED_ORIGINS: "*" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("no '*'");
  });

  it("rejects a production allowlist with an empty entry", () => {
    const result = readEnv({ ...PROD_OK, ALLOWED_ORIGINS: "https://a.example, ,https://b.example" });
    expect(result.ok).toBe(false);
  });

  it("rejects production without a signing secret", () => {
    const result = readEnv({ ...PROD_OK, AUTH_SECRET: undefined });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("AUTH_SECRET");
  });

  it("rejects a signing secret that is too short", () => {
    const result = readEnv({ NODE_ENV: "development", AUTH_SECRET: "short" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("AUTH_SECRET");
  });

  it("rejects a malformed DATABASE_URL", () => {
    const result = readEnv({ NODE_ENV: "development", DATABASE_URL: "not-a-url" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("DATABASE_URL");
  });

  it("still returns a usable env after a failure, dropping only the bad keys", () => {
    // This is what lets a misconfigured deployment boot far enough for
    // /readyz to report the problem instead of crashing at cold start.
    const result = readEnv({ ...PROD_OK, DATABASE_URL: "not-a-url" });
    expect(result.ok).toBe(false);
    expect(result.env.NODE_ENV).toBe("production");
    expect(result.env.DATABASE_URL).toBeUndefined();
    expect(result.env.AUTH_SECRET).toBe(PROD_OK.AUTH_SECRET);
  });

  it("never returns secrets through the error list", () => {
    const result = readEnv({ ...PROD_OK, DATABASE_URL: "not-a-url" });
    expect(result.errors.join(" ")).not.toContain(PROD_OK.AUTH_SECRET);
  });
});
