import { describe, expect, it, vi } from "vitest";
import { createRafWatchdog, type RafWatchdogDeps, type RafWatchdogOptions } from "./rafWatchdog";

/**
 * The watchdog is pure by construction, so these tests drive it with a fake
 * clock and fake timers — no browser, no fake `requestAnimationFrame` needed.
 */
function fakeDeps() {
  let now = 0;
  let visible = true;
  let nextId = 0;
  const tasks = new Map<number, () => void>();
  const deps: RafWatchdogDeps = {
    now: () => now,
    setInterval: (handler) => {
      const id = ++nextId;
      tasks.set(id, handler);
      return id;
    },
    clearInterval: (id) => {
      tasks.delete(id as number);
    },
    isVisible: () => visible,
  };
  return {
    deps,
    /** Advances the clock and runs every registered check once, in order. */
    advance: (ms: number) => {
      now += ms;
      for (const task of [...tasks.values()]) task();
    },
    setVisible: (value: boolean) => {
      visible = value;
    },
    pendingChecks: () => tasks.size,
  };
}

function setup(extra: Partial<RafWatchdogOptions> = {}) {
  const clock = fakeDeps();
  const onStall = vi.fn();
  const onRecover = vi.fn();
  const watchdog = createRafWatchdog({ onStall, onRecover, ...extra }, clock.deps);
  return { watchdog, clock, onStall, onRecover };
}

describe("rafWatchdog", () => {
  it("flags a stall when no frame arrives within the window", () => {
    const { watchdog, clock, onStall, onRecover } = setup();
    clock.advance(3000);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onRecover).not.toHaveBeenCalled();
    expect(watchdog.stalled).toBe(true);
  });

  it("does not flag a stall while frames keep arriving", () => {
    const { watchdog, clock, onStall } = setup();
    for (let i = 0; i < 20; i++) {
      clock.advance(500);
      watchdog.heartbeat();
    }
    expect(onStall).not.toHaveBeenCalled();
    expect(watchdog.stalled).toBe(false);
  });

  it("stays quiet while the tab is hidden — browsers stop RAF there by design", () => {
    const { clock, onStall } = setup();
    clock.setVisible(false);
    clock.advance(30_000);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("starts flagging again once the tab becomes visible and the silence continues", () => {
    const { clock, onStall } = setup();
    clock.setVisible(false);
    clock.advance(30_000);
    clock.setVisible(true);
    clock.advance(3000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it("reports recovery exactly once when frames resume after a stall", () => {
    const { watchdog, clock, onStall, onRecover } = setup();
    clock.advance(3000);
    expect(onStall).toHaveBeenCalledTimes(1);
    watchdog.heartbeat();
    clock.advance(500);
    clock.advance(500);
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(watchdog.stalled).toBe(false);
  });

  it("never reports recovery when no stall happened", () => {
    const { watchdog, clock, onRecover } = setup();
    for (let i = 0; i < 10; i++) {
      clock.advance(500);
      watchdog.heartbeat();
    }
    expect(onRecover).not.toHaveBeenCalled();
  });

  it("does not fire onStall repeatedly for one ongoing stall", () => {
    const { clock, onStall } = setup();
    clock.advance(3000);
    clock.advance(3000);
    clock.advance(3000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it("stop() cancels the periodic checks", () => {
    const { watchdog, clock, onStall } = setup();
    watchdog.stop();
    clock.advance(60_000);
    expect(onStall).not.toHaveBeenCalled();
    expect(clock.pendingChecks()).toBe(0);
  });

  it("dismisses an active stall when disarmed, and stays silent while disarmed", () => {
    const { watchdog, clock, onStall, onRecover } = setup();
    clock.advance(3000);
    expect(onStall).toHaveBeenCalledTimes(1);
    watchdog.setActive(false);
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(watchdog.stalled).toBe(false);
    clock.advance(30_000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it("arming re-opens the grace window — silence before arming is not judged", () => {
    const { watchdog, clock, onStall } = setup();
    watchdog.setActive(false);
    clock.advance(30_000); // long silence while disarmed
    watchdog.setActive(true);
    clock.advance(2000); // within the fresh window
    expect(onStall).not.toHaveBeenCalled();
    clock.advance(2000); // now past the fresh window with no frames
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it("honours custom windows", () => {
    const { clock, onStall } = setup({ stallAfterMs: 100, checkMs: 50 });
    clock.advance(150);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it("a loop that never starts is still reported as a stall", () => {
    const { clock, onStall } = setup();
    clock.advance(3000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });
});
