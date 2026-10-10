/**
 * Randomness port.
 *
 * The engine must never call `Math.random()` directly: every stochastic
 * decision flows through an injected `Rng`. That single rule buys us
 * deterministic, replayable runs — which is what makes golden tests, the
 * daily seeded challenge, ghost replays and server-side run verification
 * possible without a rewrite later.
 */
export interface Rng {
  /** Uniform float in `[0, 1)`. */
  next(): number;
  /** Uniform integer in `[0, maxExclusive)`. */
  int(maxExclusive: number): number;
  /** Uniform float in `[min, max)`. */
  range(min: number, max: number): number;
  /** Uniform integer in `[min, maxInclusive]`. */
  intRange(min: number, maxInclusive: number): number;
  /** Uniform random element. Throws if the array is empty. */
  pick<T>(items: readonly T[]): T;
  /** `true` with probability `p` (clamped to `[0, 1]`). */
  chance(p: number): boolean;
  /** Independent child stream, so one subsystem cannot desync another. */
  fork(salt: number): Rng;
}
