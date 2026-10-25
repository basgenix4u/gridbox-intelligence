/**
 * The attestation chain (task 3.8, client half).
 *
 * A score is only worth what it costs to produce. The server cannot watch the
 * game, so the client proves a real loop ran by hashing forward from a nonce
 * only the server could have issued:
 *
 *   chain[i] = sha256(chain[i-1] + ":" + i),  with chain[-1] = nonce
 *
 * The server replays the same arithmetic. A replay attack fails because the
 * nonce is bound to one run by the signed start token; a fabricated score
 * fails because forging the chain requires the nonce, and the nonce requires
 * having asked the server to start that exact run.
 *
 * Links are appended *during* play, one per interval, rather than in a batch
 * at the end. That is what makes the chain evidence of elapsed time rather
 * than a number someone typed — and it keeps the work off the game-over path,
 * where a long synchronous hash loop would stutter the death recap.
 *
 * WebCrypto only. `crypto.subtle` has shipped in every browser that can run
 * this game (Chrome 37+, Firefox 34+, Safari 11+), and the deployment is
 * HTTPS-only, which is the one thing it additionally requires. A hand-rolled
 * SHA-256 was written here first and deleted: ~60 lines of cryptography that
 * must be bit-perfect is a far worse trade than failing honestly on a platform
 * nobody uses. When the API is absent the attestor says so and the run
 * submits without a chain — which the server then flags, exactly as it should.
 */

/** One link per 500 ms of play — matches the server's expectation. */
export const ATTESTATION_INTERVAL_MS = 500;

/** Hard ceiling from the contract; further ticks are ignored. */
export const MAX_CHAIN_LINKS = 60_000;

export type Sha256 = (input: string) => Promise<string>;

/**
 * The platform's SHA-256, or `null` where WebCrypto is unavailable. Callers
 * must handle `null` — it is a capability, not an error.
 */
export function createSha256(): Sha256 | null {
  const subtle = typeof globalThis.crypto !== "undefined" ? globalThis.crypto.subtle : undefined;
  if (!subtle) return null;
  return async (input: string): Promise<string> => {
    const bytes = new TextEncoder().encode(input);
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };
}

/** The wire shape the server verifies. */
export interface Attestation {
  nonce: string;
  chain: string[];
}

/**
 * Accumulates links while a run is in progress.
 *
 * Usage: construct with the server's nonce, call `tick()` from the game loop,
 * and `finish()` once at the end. `tick` never awaits, so the frame rate is
 * unaffected no matter how slow hashing is.
 */
export class Attestor {
  /**
   * Links committed to so far. Incremented synchronously in `tick`, so the
   * count is truthful the moment a link is promised rather than once its hash
   * happens to resolve.
   */
  private scheduled = 0;
  /** Digests that have actually resolved, in order. */
  private readonly completed: string[] = [];
  /** The hash of the last completed link — the seed for the next one. */
  private previous: string;
  private lastLinkAt: number | null = null;
  /** Serialises hashing so links land in order even out of order in time. */
  private pending: Promise<void> = Promise.resolve();

  readonly supported: boolean;

  constructor(
    private readonly nonce: string,
    private readonly intervalMs: number = ATTESTATION_INTERVAL_MS,
    sha: Sha256 | null = createSha256(),
  ) {
    this.supported = sha !== null;
    this.previous = nonce;
    this.sha = sha;
  }

  private readonly sha: Sha256 | null;

  /** Links this run has committed to. */
  get length(): number {
    return this.scheduled;
  }

  /**
   * Records a link if `intervalMs` of play time has passed since the last one.
   * Returns immediately; hashing continues in the background.
   */
  tick(nowMs: number): void {
    if (this.scheduled >= MAX_CHAIN_LINKS) return;
    if (this.lastLinkAt !== null && nowMs - this.lastLinkAt < this.intervalMs) return;
    if (!this.sha) return;

    this.lastLinkAt = nowMs;
    const index = this.scheduled++;
    const sha = this.sha;

    // The input is derived *inside* the continuation: `previous` only becomes
    // the new link once the previous hash has resolved, and computing the input
    // eagerly here would read a stale value and fork the chain.
    this.pending = this.pending.then(async () => {
      const digest = await sha(`${this.previous}:${index}`);
      this.completed.push(digest);
      this.previous = digest;
    });
  }

  /**
   * Waits for in-flight hashes and returns the finished chain. Safe to call
   * more than once; later calls see any links added since.
   */
  async finish(): Promise<Attestation> {
    await this.pending;
    return { nonce: this.nonce, chain: [...this.completed] };
  }
}
