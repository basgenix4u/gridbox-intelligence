import { describe, expect, it } from "vitest";
import { assessPlausibility, HARNESS_SCORE_PER_SECOND_P99 } from "./anticheat.js";
import { SUSPECT_SCORE_PER_SECOND } from "../../src/shared/calibration.js";

/** A run the greedy bot could plausibly produce. */
const PLAUSIBLE = {
  score: 12_000,
  level: 22,
  chips: 150,
  kills: 20,
  maxCombo: 8,
  durationMs: 60_000,
};

describe("assessPlausibility — tier 1 (rejected)", () => {
  it("accepts a plausible run", () => {
    const result = assessPlausibility(PLAUSIBLE, { scorePerSecondP99: HARNESS_SCORE_PER_SECOND_P99 });
    expect(result.verdict).toBe("ok");
    expect(result.reasons).toEqual([]);
  });

  it("rejects a level the chip count cannot produce", () => {
    const result = assessPlausibility({ ...PLAUSIBLE, level: 99 });
    expect(result.verdict).toBe("rejected");
    expect(result.reasons.join(" ")).toContain("level");
  });

  it("rejects a combo beyond the chip count", () => {
    const result = assessPlausibility({ ...PLAUSIBLE, maxCombo: 8, chips: 2 });
    expect(result.verdict).toBe("rejected");
    expect(result.reasons.join(" ")).toContain("maxCombo");
  });

  it("rejects a chip rate no hand can reach", () => {
    const result = assessPlausibility({ ...PLAUSIBLE, chips: 600, level: 86, durationMs: 60_000 });
    expect(result.verdict).toBe("rejected");
    expect(result.reasons.join(" ")).toContain("chip rate");
  });

  it("rejects a score rate above the physical ceiling", () => {
    const result = assessPlausibility({ ...PLAUSIBLE, score: 900_000, chips: 1000, level: 100 });
    expect(result.verdict).toBe("rejected");
    expect(result.reasons.join(" ")).toContain("score rate");
  });

  it("rejects a score above the arithmetic ceiling for the run", () => {
    const result = assessPlausibility({ ...PLAUSIBLE, score: 60_000, chips: 150, kills: 20 });
    expect(result.verdict).toBe("rejected");
    expect(result.reasons.join(" ")).toContain("ceiling");
  });

  it("collects every reason it finds", () => {
    const result = assessPlausibility({ ...PLAUSIBLE, level: 99, maxCombo: 99 });
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("assessPlausibility — tier 2 (suspect)", () => {
  it("flags a run above p99 + 20% but structurally possible", () => {
    // 25k in 60s = 417/s — above the 303/s threshold, under the 1200/s ceiling.
    const result = assessPlausibility(
      { ...PLAUSIBLE, score: 25_000, chips: 300, level: 43 },
      { scorePerSecondP99: HARNESS_SCORE_PER_SECOND_P99 },
    );
    expect(result.verdict).toBe("suspect");
    expect(result.reasons.join(" ")).toContain("p99");
  });

  it("stays ok just under the threshold", () => {
    // 17,400 in 60s = 290/s — just under 303/s.
    const result = assessPlausibility(
      { ...PLAUSIBLE, score: 17_400, chips: 220, level: 32 },
      { scorePerSecondP99: HARNESS_SCORE_PER_SECOND_P99 },
    );
    expect(result.verdict).toBe("ok");
  });

  it("skips the suspect tier when no p99 was measured", () => {
    const result = assessPlausibility({ ...PLAUSIBLE, score: 25_000, chips: 300, level: 43 });
    expect(result.verdict).toBe("ok");
  });

  it("ignores a nonsense p99", () => {
    const result = assessPlausibility(PLAUSIBLE, { scorePerSecondP99: 0 });
    expect(result.verdict).toBe("ok");
  });
});

describe("calibration constant", () => {
  it("matches the harness measurement recorded in PRD §3", () => {
    expect(HARNESS_SCORE_PER_SECOND_P99).toBe(253);
    // The derived threshold is what the suspect tier enforces.
    expect(SUSPECT_SCORE_PER_SECOND).toBe(304);
  });
});
