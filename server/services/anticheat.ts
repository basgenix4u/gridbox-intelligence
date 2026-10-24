/**
 * Anti-cheat plausibility rules (locked decision, PRD §3 — two-tier).
 *
 * Tier 1 — *rejected*: arithmetically impossible runs. These are proofs, not
 * statistics: a level the chip count cannot produce, a chip rate no thumb can
 * reach, a score above the theoretical ceiling for the duration. Rejecting
 * them cannot produce a false positive, because no legitimate client can emit
 * them.
 *
 * Tier 2 — *suspect*: statistically implausible runs — above the p99 of the
 * balance-harness distribution plus a 20% margin. Suspect runs are stored and
 * kept for analysis but hidden from the boards. That is what "flagged rather
 * than silently accepted" means in practice.
 *
 * The p99 comes from the headless harness (`src/game/headlessRun.test.ts`
 * measures it); it is injected so the threshold can be re-derived when the
 * engine's balance changes.
 */

export interface PlausibilityInput {
  score: number;
  level: number;
  chips: number;
  kills: number;
  maxCombo: number;
  durationMs: number;
}

export type PlausibilityVerdict = "ok" | "suspect" | "rejected";

export interface PlausibilityResult {
  verdict: PlausibilityVerdict;
  reasons: string[];
}

/** Hard ceilings — no legitimate client can exceed these. */
export const LIMITS = {
  /** Chip value is 10 × combo, combo caps at 8 → 80 per chip. */
  MAX_CHIP_VALUE: 80,
  /** Highest kill value (ORACLE). */
  MAX_KILL_VALUE: 150,
  /** A hop every ~125 ms is beyond human; 8/s is generous. */
  MAX_CHIPS_PER_SECOND: 8,
  MAX_KILLS_PER_SECOND: 20,
  /** Chip ceiling (8/s × 80) plus a generous kill allowance. */
  MAX_SCORE_PER_SECOND: 1200,
  /** Suspect threshold: harness p99 score-per-second × this margin. */
  SUSPECT_MARGIN,
  /** Chips per level (engine: level = 1 + floor(chips / 7)). */
  CHIPS_PER_LEVEL: 7,
  MAX_COMBO: 8,
} as const;

import { HARNESS_SCORE_PER_SECOND_P99, SUSPECT_MARGIN } from "../../src/shared/calibration.js";

/**
 * p99 score-per-second of the skilled (greedy) bot, measured by the headless
 * harness (see src/shared/calibration.ts for the derivation and the drift
 * guard). Re-exported so callers do not need to reach across the boundary.
 */
export { HARNESS_SCORE_PER_SECOND_P99 };

export interface PlausibilityOptions {
  /** p99 of the skilled-bot score-per-second distribution, if measured. */
  scorePerSecondP99?: number;
}

export function assessPlausibility(input: PlausibilityInput, options: PlausibilityOptions = {}): PlausibilityResult {
  const reasons: string[] = [];
  const seconds = Math.max(input.durationMs / 1000, 0.001);

  // ---- structural impossibilities (reject) ----
  const maxLevelFromChips = 1 + Math.floor(input.chips / LIMITS.CHIPS_PER_LEVEL);
  if (input.level > maxLevelFromChips) {
    reasons.push(`level ${input.level} impossible for ${input.chips} chips (max ${maxLevelFromChips})`);
  }
  const maxComboFromChips = Math.min(LIMITS.MAX_COMBO, input.chips + 1);
  if (input.maxCombo > maxComboFromChips) {
    reasons.push(`maxCombo ${input.maxCombo} impossible for ${input.chips} chips (max ${maxComboFromChips})`);
  }
  if (input.chips / seconds > LIMITS.MAX_CHIPS_PER_SECOND) {
    reasons.push(`chip rate ${(input.chips / seconds).toFixed(1)}/s exceeds ${LIMITS.MAX_CHIPS_PER_SECOND}/s`);
  }
  if (input.kills / seconds > LIMITS.MAX_KILLS_PER_SECOND) {
    reasons.push(`kill rate ${(input.kills / seconds).toFixed(1)}/s exceeds ${LIMITS.MAX_KILLS_PER_SECOND}/s`);
  }
  const scorePerSecond = input.score / seconds;
  if (scorePerSecond > LIMITS.MAX_SCORE_PER_SECOND) {
    reasons.push(`score rate ${scorePerSecond.toFixed(0)}/s exceeds ceiling ${LIMITS.MAX_SCORE_PER_SECOND}/s`);
  }
  const scoreCeiling = input.chips * LIMITS.MAX_CHIP_VALUE + input.kills * LIMITS.MAX_KILL_VALUE;
  if (input.score > scoreCeiling * 1.5 + 1000) {
    reasons.push(`score ${input.score} exceeds the ceiling ${Math.round(scoreCeiling * 1.5 + 1000)} for this run`);
  }

  if (reasons.length > 0) return { verdict: "rejected", reasons };

  // ---- statistical implausibility (suspect) ----
  const p99 = options.scorePerSecondP99;
  if (p99 !== undefined && p99 > 0 && scorePerSecond > p99 * LIMITS.SUSPECT_MARGIN) {
    reasons.push(
      `score rate ${scorePerSecond.toFixed(0)}/s above p99+${Math.round((LIMITS.SUSPECT_MARGIN - 1) * 100)}% (${(p99 * LIMITS.SUSPECT_MARGIN).toFixed(0)}/s)`,
    );
    return { verdict: "suspect", reasons };
  }

  return { verdict: "ok", reasons };
}
