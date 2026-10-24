/**
 * requestAnimationFrame watchdog — the pure decision core.
 *
 * A game loop that silently stops is the worst failure mode an arcade game has:
 * the canvas freezes mid-frame, nothing throws, and the player is left staring
 * at a dead board with no explanation. This module decides, from a heartbeat
 * and a clock, when a *visible* tab's loop has stalled, so the UI can pause the
 * game and say so instead of freezing without a word.
 *
 * It is deliberately pure: the clock, the timers and the visibility probe are
 * all injected, so every rule below is unit-tested without a browser. Hidden
 * tabs are exempt — browsers legitimately stop requestAnimationFrame there, and
 * the app already pauses on `visibilitychange`.
 */

export interface RafWatchdogDeps {
  /** Monotonic clock in milliseconds. */
  now: () => number;
  /** Registers the periodic check; returns an opaque handle. */
  setInterval: (handler: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  /** False while the tab is hidden — silence there is not a stall. */
  isVisible: () => boolean;
}

export interface RafWatchdogOptions {
  /** Milliseconds without a frame before the loop counts as stalled. Default 2500. */
  stallAfterMs?: number;
  /** How often the watchdog re-checks. Default 500. */
  checkMs?: number;
  /** Fired once when a stall is detected. */
  onStall: () => void;
  /** Fired once when frames resume after a stall, or when disarmed mid-stall. */
  onRecover?: () => void;
}

export interface RafWatchdog {
  /** Called by the render loop on every frame. */
  heartbeat: () => void;
  /**
   * Arm or disarm the watchdog. Arming re-opens the grace window so a fresh
   * run is never judged by the silence that came before it; disarming while a
   * stall is being reported dismisses it.
   */
  setActive: (active: boolean) => void;
  /** Stop the watchdog for good (component unmount). */
  stop: () => void;
  /** Whether a stall is currently being reported. */
  readonly stalled: boolean;
}

/** Default 2.5 s: far above any healthy frame gap, below the point a player gives up. */
export const DEFAULT_STALL_AFTER_MS = 2500;
export const DEFAULT_CHECK_MS = 500;

export function createRafWatchdog(options: RafWatchdogOptions, deps: RafWatchdogDeps): RafWatchdog {
  const stallAfterMs = options.stallAfterMs ?? DEFAULT_STALL_AFTER_MS;
  const checkMs = options.checkMs ?? DEFAULT_CHECK_MS;
  let lastFrameAt = deps.now();
  let active = true;
  let stalled = false;

  const check = (): void => {
    if (!active || !deps.isVisible()) return;
    const silentFor = deps.now() - lastFrameAt;
    if (!stalled && silentFor > stallAfterMs) {
      stalled = true;
      options.onStall();
    } else if (stalled && silentFor <= stallAfterMs) {
      stalled = false;
      options.onRecover?.();
    }
  };

  const handle = deps.setInterval(check, checkMs);

  return {
    heartbeat: () => {
      lastFrameAt = deps.now();
    },
    setActive: (next: boolean) => {
      if (next === active) return;
      active = next;
      // Re-open the grace window on every arm, and dismiss a stall that was
      // being reported when the guard was disarmed (e.g. the run ended).
      lastFrameAt = deps.now();
      if (!next && stalled) {
        stalled = false;
        options.onRecover?.();
      }
    },
    stop: () => deps.clearInterval(handle),
    get stalled() {
      return stalled;
    },
  };
}

/** Browser wiring for {@link createRafWatchdog}. */
export const browserRafWatchdogDeps: RafWatchdogDeps = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  isVisible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
};
