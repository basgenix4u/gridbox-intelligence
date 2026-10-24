import { useCallback, useState } from "react";
import type { Game } from "@/game/engine";

export interface StallGuard {
  /** A stall is being reported and the run is paused. */
  stalled: boolean;
  /** Watchdog callback: pause the run and surface the notice. */
  onStall: () => void;
  /** Watchdog callback: frames resumed (or the guard was disarmed) — dismiss. */
  onStallRecover: () => void;
  /** Manual resume from the notice. */
  resume: () => void;
}

/**
 * Bridges the canvas watchdog to the game engine.
 *
 * A stalled render loop freezes the canvas without throwing, so the only safe
 * response is to pause the run and tell the player — never to leave them
 * staring at a dead board. Recovery auto-dismisses the notice; the player can
 * also resume by hand.
 */
export function useStallGuard(game: Game): StallGuard {
  const [stalled, setStalled] = useState(false);

  const onStall = useCallback(() => {
    game.pause();
    setStalled(true);
  }, [game]);

  const onStallRecover = useCallback(() => {
    game.resume();
    setStalled(false);
  }, [game]);

  const resume = useCallback(() => {
    game.resume();
    setStalled(false);
  }, [game]);

  return { stalled, onStall, onStallRecover, resume };
}
