import { describe, expect, it } from "vitest";
import {
  CHIPS_PER_LEVEL,
  KINDS,
  KIND_UNLOCK_LEVEL,
  MAX_COMBO,
  kindWeights,
  levelMaxEnemies,
  levelPeriod,
  levelSpawnEvery,
} from "./constants";

/**
 * These assertions pin the difficulty curve. They exist so a balance tweak is
 * a deliberate, reviewed change rather than an accidental one — if you move a
 * constant, this suite should fail until you have thought about it.
 */
describe("levelPeriod", () => {
  it("decreases as the level rises", () => {
    for (let l = 1; l < 20; l++) {
      expect(levelPeriod(l + 1)).toBeLessThanOrEqual(levelPeriod(l));
    }
  });

  it("never drops below the 260ms floor", () => {
    expect(levelPeriod(100)).toBe(260);
  });

  it("starts at 640ms", () => {
    expect(levelPeriod(1)).toBe(640);
  });
});

describe("levelMaxEnemies", () => {
  it("grows by one per level up to a ceiling of 8", () => {
    expect(levelMaxEnemies(1)).toBe(2);
    expect(levelMaxEnemies(7)).toBe(8);
    expect(levelMaxEnemies(50)).toBe(8);
  });

  it("is monotonic", () => {
    for (let l = 1; l < 20; l++) expect(levelMaxEnemies(l + 1)).toBeGreaterThanOrEqual(levelMaxEnemies(l));
  });
});

describe("levelSpawnEvery", () => {
  it("decreases as the level rises and floors at 1000ms", () => {
    expect(levelSpawnEvery(1)).toBe(2800);
    expect(levelSpawnEvery(100)).toBe(1000);
    for (let l = 1; l < 20; l++) expect(levelSpawnEvery(l + 1)).toBeLessThanOrEqual(levelSpawnEvery(l));
  });
});

describe("kindWeights", () => {
  it("introduces exactly one archetype at a time", () => {
    const unlocked = (l: number): number => kindWeights(l).filter((w) => w > 0).length;
    expect(unlocked(1)).toBe(1);
    expect(unlocked(2)).toBe(2);
    expect(unlocked(3)).toBe(3);
    expect(unlocked(5)).toBe(4);
  });

  it("always sums to 1 so the weighted pick is well-formed", () => {
    for (let l = 1; l <= 30; l++) {
      const total = kindWeights(l).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("never contains negative weights", () => {
    for (let l = 1; l <= 30; l++) {
      for (const w of kindWeights(l)) expect(w).toBeGreaterThanOrEqual(0);
    }
  });

  it("shifts weight toward the deadlier archetypes at high levels", () => {
    expect(kindWeights(20)[3]).toBeGreaterThan(kindWeights(5)[3]);
    expect(kindWeights(20)[0]).toBeLessThan(kindWeights(5)[0]);
  });
});

describe("archetype definitions", () => {
  it("has one unlock level per archetype", () => {
    expect(KIND_UNLOCK_LEVEL).toHaveLength(KINDS.length);
  });

  it("unlocks in ascending order", () => {
    const sorted = [...KIND_UNLOCK_LEVEL].sort((a, b) => a - b);
    expect(KIND_UNLOCK_LEVEL).toEqual(sorted);
  });

  it("scores the deadlier archetypes higher", () => {
    for (let i = 1; i < KINDS.length; i++) {
      expect(KINDS[i].score).toBeGreaterThan(KINDS[i - 1].score);
    }
  });

  it("only unlocks an archetype whose weight is non-zero at that level", () => {
    KINDS.forEach((_, i) => {
      const level = KIND_UNLOCK_LEVEL[i];
      expect(kindWeights(level)[i]).toBeGreaterThan(0);
    });
  });
});

describe("economy constants", () => {
  it("caps the combo at 8 and advances a level every 7 chips", () => {
    expect(MAX_COMBO).toBe(8);
    expect(CHIPS_PER_LEVEL).toBe(7);
  });
});
