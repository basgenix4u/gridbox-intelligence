/**
 * Balance-harness calibration (PRD §3, two-tier anti-cheat).
 *
 * The suspect tier of the server's plausibility check fires above
 * `HARNESS_SCORE_PER_SECOND_P99 × SUSPECT_MARGIN`. That p99 is *measured*, not
 * guessed: it is the 99th percentile of score-per-second produced by the
 * skilled (greedy) bot over the seeded cohort in
 * `src/game/headlessRun.test.ts`, which asserts the measurement still matches
 * this constant. When the scoring formula or the difficulty curve changes, that
 * test fails first and this number is re-derived — the threshold can never
 * silently drift away from the engine it guards.
 *
 * Measured 2026-10-24 over 60 seeds: p50 201, p90 223, p99 253, max 253.
 */

/** p99 score-per-second of the skilled bot (greedy policy, 60 seeds). */
export const HARNESS_SCORE_PER_SECOND_P99 = 253;

/** Suspect threshold = p99 × this margin. The extra 20% absorbs run-to-run variance. */
export const SUSPECT_MARGIN = 1.2;

/** The derived per-second rate above which a run is flagged as suspect. */
export const SUSPECT_SCORE_PER_SECOND = Math.round(HARNESS_SCORE_PER_SECOND_P99 * SUSPECT_MARGIN);
