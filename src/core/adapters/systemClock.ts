import type { Clock } from "@/core/ports/clock";

export function createSystemClock(): Clock {
  const hasPerformance = typeof performance !== "undefined" && typeof performance.now === "function";
  return {
    now: () => (hasPerformance ? performance.now() : Date.now()),
    wallNow: () => Date.now(),
  };
}

/** Fixed/manual clock for deterministic tests. */
export function createManualClock(start = 0): Clock & { advance(ms: number): void; set(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    wallNow: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}
