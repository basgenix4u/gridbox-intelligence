import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, allProgress, markUnlocked, nearest, newlyUnlocked, progressOf } from "./achievements";
import { defaultProfile, type Profile } from "./profile";

function profile(overrides: Partial<Profile> = {}): Profile {
  return { ...defaultProfile(0), ...overrides };
}

describe("catalogue", () => {
  it("has unique ids and sane targets", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.target).toBeGreaterThan(0);
      expect(a.endowed).toBeGreaterThanOrEqual(0);
      expect(a.endowed).toBeLessThan(a.target);
    }
  });
});

describe("progressOf", () => {
  const chip100 = ACHIEVEMENTS.find((a) => a.id === "chip-100")!;

  it("displays the endowed head start before any play", () => {
    const pr = progressOf(chip100, profile(), new Set());
    expect(pr.current).toBe(25); // endowed progress (Nunes & Dreze 2006)
    expect(pr.pct).toBeCloseTo(0.25);
  });

  it("never displays below the endowed value", () => {
    const pr = progressOf(chip100, profile({ totalChips: 3 }), new Set());
    expect(pr.current).toBe(25);
  });

  it("tracks measured progress above the head start", () => {
    const pr = progressOf(chip100, profile({ totalChips: 60 }), new Set());
    expect(pr.current).toBe(60);
    expect(pr.remaining).toBe(40);
  });

  it("clamps at the target", () => {
    const pr = progressOf(chip100, profile({ totalChips: 999 }), new Set());
    expect(pr.current).toBe(100);
    expect(pr.pct).toBe(1);
    expect(pr.unlocked).toBe(true);
  });
});

describe("newlyUnlocked / markUnlocked", () => {
  it("reports goals met but unclaimed", () => {
    const p = profile({ totalChips: 10, maxCombo: 8 });
    const ids = newlyUnlocked(p);
    expect(ids).toContain("first-harvest");
    expect(ids).toContain("combo-8");
    expect(ids).not.toContain("chip-100");
  });

  it("does not re-report a claimed achievement", () => {
    const p = markUnlocked(profile({ totalChips: 10 }), ["first-harvest"]);
    expect(newlyUnlocked(p)).not.toContain("first-harvest");
  });

  it("is idempotent when claiming", () => {
    const p = markUnlocked(profile({ totalChips: 10 }), ["first-harvest"]);
    expect(markUnlocked(p, ["first-harvest"]).unlocked).toEqual(["first-harvest"]);
  });
});

describe("nearest", () => {
  it("ranks by goal-gradient proximity, nearest first", () => {
    const p = profile({ totalChips: 92, runsPlayed: 3, maxCombo: 2 });
    const list = nearest(p, 3);
    expect(list[0]?.def.id).toBe("chip-100"); // 92/100 — closest
    expect(list[0]?.remaining).toBe(8);
    for (const pr of list) expect(pr.unlocked).toBe(false);
  });

  it("excludes unlocked and untouched achievements", () => {
    const p = markUnlocked(profile({ totalChips: 92 }), ["chip-100"]);
    const ids = nearest(p, 5).map((pr) => pr.def.id);
    expect(ids).not.toContain("chip-100");
    expect(ids).not.toContain("pulse-5"); // 0 measured, 1/5 endowed but untouched
  });

  it("respects the requested count", () => {
    expect(nearest(profile({ totalChips: 50, totalKills: 60 }), 1)).toHaveLength(1);
  });
});

describe("allProgress", () => {
  it("covers the whole catalogue", () => {
    expect(allProgress(profile())).toHaveLength(ACHIEVEMENTS.length);
  });
});
