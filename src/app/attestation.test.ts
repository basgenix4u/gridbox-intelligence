import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Attestor, ATTESTATION_INTERVAL_MS, createSha256, type Sha256 } from "./attestation.js";

/** The server's own arithmetic, computed here independently as an oracle. */
function serverChain(nonce: string, links: number): string[] {
  const out: string[] = [];
  let prev = nonce;
  for (let i = 0; i < links; i++) {
    prev = createHash("sha256").update(`${prev}:${i}`).digest("hex");
    out.push(prev);
  }
  return out;
}

/** A deterministic, synchronous stand-in so tests never touch WebCrypto. */
function fakeSha(): Sha256 {
  // Synchronous underneath: the tests assert ordering, not hashing latency.
  return (input: string): Promise<string> =>
    Promise.resolve(createHash("sha256").update(input).digest("hex"));
}

describe("createSha256", () => {
  it("returns a working hash where WebCrypto exists", async () => {
    const sha = createSha256();
    expect(sha).not.toBeNull();
    expect(await sha!("nonce:0")).toBe(createHash("sha256").update("nonce:0").digest("hex"));
  });

  it("returns null when the platform has no subtle crypto", () => {
    // `crypto` is a read-only global in Node, so stub it rather than assign.
    vi.stubGlobal("crypto", undefined);
    try {
      expect(createSha256()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
    // And the platform hash is back afterwards.
    expect(createSha256()).not.toBeNull();
  });
});

describe("Attestor", () => {
  it("produces the chain the server recomputes", async () => {
    const nonce = "server-issued-nonce";
    const attestor = new Attestor(nonce, ATTESTATION_INTERVAL_MS, fakeSha());
    for (let i = 0; i < 10; i++) attestor.tick(i * ATTESTATION_INTERVAL_MS);
    const finished = await attestor.finish();

    expect(finished.nonce).toBe(nonce);
    expect(finished.chain).toEqual(serverChain(nonce, 10));
  });

  it("seeds the chain from the nonce, not from itself", async () => {
    const attestor = new Attestor("n0nce", 500, fakeSha());
    attestor.tick(0);
    const { chain } = await attestor.finish();
    expect(chain[0]).toBe(createHash("sha256").update("n0nce:0").digest("hex"));
  });

  it("emits one link per interval, not one per frame", async () => {
    const attestor = new Attestor("nonce", 500, fakeSha());
    for (let f = 0; f < 120; f++) attestor.tick(f * (1000 / 60)); // 2s at 60fps
    const { chain } = await attestor.finish();
    expect(chain.length).toBeGreaterThanOrEqual(3);
    expect(chain.length).toBeLessThanOrEqual(5);
  });

  it("records the first link immediately so a very short run still has one", () => {
    const attestor = new Attestor("nonce", 500, fakeSha());
    attestor.tick(0);
    expect(attestor.length).toBe(1);
  });

  it("does not double-count a tick inside the same interval", () => {
    const attestor = new Attestor("nonce", 500, fakeSha());
    attestor.tick(0);
    attestor.tick(100);
    attestor.tick(499);
    expect(attestor.length).toBe(1);
    attestor.tick(500);
    expect(attestor.length).toBe(2);
  });

  it("keeps links in order when hashes resolve out of order", async () => {
    // The first hash is the slowest: eager input derivation would fork here.
    const delays = [40, 1, 20, 5];
    const sha: Sha256 = (input) => {
      const delay = delays[Number(input.split(":")[1])] ?? 0;
      return new Promise((resolve) =>
        setTimeout(() => resolve(createHash("sha256").update(input).digest("hex")), delay),
      );
    };
    const attestor = new Attestor("nonce", 100, sha);
    for (let i = 0; i < 4; i++) attestor.tick(i * 100);
    const { chain } = await attestor.finish();
    expect(chain).toEqual(serverChain("nonce", 4));
  });

  it("stops growing at the contract ceiling", async () => {
    const attestor = new Attestor("nonce", 1, fakeSha());
    for (let i = 0; i < 61_000; i++) attestor.tick(i);
    expect(attestor.length).toBe(60_000);
    const { chain } = await attestor.finish();
    expect(chain).toHaveLength(60_000);
  });

  it("never mutates the returned chain", async () => {
    const attestor = new Attestor("nonce", 10, fakeSha());
    attestor.tick(0);
    attestor.tick(10);
    const first = await attestor.finish();
    first.chain.push("tampered");
    const second = await attestor.finish();
    expect(second.chain).not.toContain("tampered");
  });

  it("picks up links added after an earlier finish", async () => {
    const attestor = new Attestor("nonce", 100, fakeSha());
    attestor.tick(0);
    const first = await attestor.finish();
    attestor.tick(500);
    const second = await attestor.finish();
    expect(second.chain).toHaveLength(first.chain.length + 1);
  });

  it("finish resolves even when nothing was ticked", async () => {
    const attestor = new Attestor("nonce", 500, fakeSha());
    await expect(attestor.finish()).resolves.toEqual({ nonce: "nonce", chain: [] });
  });

  it("does not block the caller while hashing", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const sha: Sha256 = async (input) => {
      await gate;
      return createHash("sha256").update(input).digest("hex");
    };
    const attestor = new Attestor("nonce", 10, sha);
    const started = Date.now();
    for (let i = 0; i < 50; i++) attestor.tick(i * 10);
    expect(Date.now() - started).toBeLessThan(200);
    release();
    await attestor.finish();
  });

  it("uses the default interval when none is given", () => {
    const attestor = new Attestor("nonce", undefined, fakeSha());
    attestor.tick(0);
    attestor.tick(ATTESTATION_INTERVAL_MS - 1);
    expect(attestor.length).toBe(1);
    attestor.tick(ATTESTATION_INTERVAL_MS);
    expect(attestor.length).toBe(2);
  });

  it("uses a spy-able hash so injection is observable", async () => {
    const sha = vi.fn((input: string) => Promise.resolve(createHash("sha256").update(input).digest("hex")));
    const attestor = new Attestor("nonce", 10, sha);
    attestor.tick(0);
    await attestor.finish();
    expect(sha).toHaveBeenCalledWith("nonce:0");
  });

  it("reports unsupported rather than throwing when WebCrypto is absent", async () => {
    const attestor = new Attestor("nonce", 500, null);
    expect(attestor.supported).toBe(false);
    for (let i = 0; i < 5; i++) attestor.tick(i * 500);
    expect(attestor.length).toBe(0);
    await expect(attestor.finish()).resolves.toEqual({ nonce: "nonce", chain: [] });
  });

  it("is supported when the platform hash is available", () => {
    const attestor = new Attestor("nonce", 500, fakeSha());
    expect(attestor.supported).toBe(true);
  });
});
