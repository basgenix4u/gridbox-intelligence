import type { Rng } from "@/core/ports/rng";

/**
 * `mulberry32` — a small, fast, well-distributed 32-bit PRNG.
 *
 * Chosen because it is deterministic across every JS engine (no float drift
 * concerns for our purposes), has a 2^32 period (ample for a 60 s run), and
 * is trivially serialisable: a run is fully described by one uint32 seed.
 */
function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a. Turns a string or number into a well-spread uint32 seed. */
export function hashSeed(input: string | number): number {
  if (typeof input === "number" && Number.isInteger(input)) return input >>> 0;
  const s = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Cryptographically random seed for non-deterministic (endless) runs. */
export function randomSeed(): number {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    webCrypto.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Deterministic seed for a given UTC day — powers the daily challenge. */
export function dailySeed(date: Date = new Date(), salt = "gridbox"): number {
  const day = date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return hashSeed(`${salt}:${day}`);
}

export function createRng(seed: number | string = randomSeed()): Rng {
  const next = mulberry32(hashSeed(seed));
  const rng: Rng = {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    range: (min, max) => min + next() * (max - min),
    intRange: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error("Rng.pick: cannot pick from an empty array");
      return items[Math.floor(next() * items.length)];
    },
    chance: (p) => next() < Math.min(1, Math.max(0, p)),
    fork: (salt) => createRng((hashSeed(salt) ^ Math.floor(next() * 0xffffffff)) >>> 0),
  };
  return rng;
}
