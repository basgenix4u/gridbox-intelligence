import { describe, expect, it } from "vitest";
import { createRng, dailySeed, hashSeed, randomSeed } from "./seededRng";

describe("hashSeed", () => {
  it("is stable for the same input", () => {
    expect(hashSeed("gridbox")).toBe(hashSeed("gridbox"));
  });

  it("returns integers unchanged", () => {
    expect(hashSeed(42)).toBe(42);
  });

  it("produces different values for different inputs", () => {
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });

  it("always yields an unsigned 32-bit integer", () => {
    for (const input of ["", "x", "gridbox:2026-10-10", 0, -1]) {
      const h = hashSeed(input);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("createRng", () => {
  it("is deterministic: the same seed yields the same sequence", () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("diverges for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("stays within [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 5_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() stays within [0, max)", () => {
    const rng = createRng(99);
    for (let i = 0; i < 5_000; i++) {
      const v = rng.int(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it("intRange() is inclusive on both ends", () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) {
      const v = rng.intRange(1, 4);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([1, 2, 3, 4]));
  });

  it("range() stays within [min, max)", () => {
    const rng = createRng(11);
    for (let i = 0; i < 1_000; i++) {
      const v = rng.range(-3, 8);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(8);
    }
  });

  it("pick() returns an element from the array", () => {
    const rng = createRng(3);
    const items = ["a", "b", "c"];
    for (let i = 0; i < 200; i++) expect(items).toContain(rng.pick(items));
  });

  it("pick() throws on an empty array rather than returning undefined", () => {
    expect(() => createRng(1).pick([])).toThrow(/empty array/);
  });

  it("chance(0) is never true and chance(1) is always true", () => {
    const rng = createRng(8);
    for (let i = 0; i < 1_000; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("chance() clamps out-of-range probabilities", () => {
    const rng = createRng(8);
    expect(rng.chance(-5)).toBe(false);
    expect(rng.chance(5)).toBe(true);
  });

  it("fork() produces an independent but reproducible child stream", () => {
    const parent = createRng(2026);
    const childA = parent.fork(1);
    const childB = createRng(2026).fork(1);
    expect(Array.from({ length: 10 }, () => childA.next())).toEqual(Array.from({ length: 10 }, () => childB.next()));
    // A different salt must not reproduce the same stream.
    const other = createRng(2026).fork(2);
    expect(other.next()).not.toBe(createRng(2026).fork(1).next());
  });
});

describe("randomSeed", () => {
  it("produces unsigned 32-bit integers", () => {
    for (let i = 0; i < 100; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("varies between calls", () => {
    const seeds = new Set(Array.from({ length: 50 }, () => randomSeed()));
    expect(seeds.size).toBeGreaterThan(1);
  });
});

describe("dailySeed", () => {
  it("is identical for every moment within one UTC day", () => {
    const seed = dailySeed(new Date("2026-10-10T00:00:00.000Z"));
    expect(dailySeed(new Date("2026-10-10T23:59:59.999Z"))).toBe(seed);
  });

  it("differs between days", () => {
    expect(dailySeed(new Date("2026-10-10T12:00:00Z"))).not.toBe(dailySeed(new Date("2026-10-11T12:00:00Z")));
  });

  it("is salted, so namespaces do not collide", () => {
    const day = new Date("2026-10-10T12:00:00Z");
    expect(dailySeed(day, "a")).not.toBe(dailySeed(day, "b"));
  });
});
