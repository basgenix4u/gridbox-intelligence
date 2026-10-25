/**
 * Global keyboard and lifecycle bindings (task 4.1).
 *
 * Extracted from `App.tsx`, which had all of this inline in one ~70-line
 * effect. The handlers are passed in rather than reached for, so this hook owns
 * *when* input is live and nothing else — that is the only thing that makes it
 * testable without mounting the whole game.
 *
 * Phase-dependent behaviour is deliberately the caller's business: this hook
 * reads the phase from a getter so the listeners never re-subscribe when the
 * phase changes. Subscribing on every phase change was the original design and
 * it worked, but it meant every keypress paid for a teardown and re-add.
 */

import { useEffect } from "react";
import type { Dir } from "../game/types.js";

export type Phase = "menu" | "playing" | "paused" | "gameover";
export type MenuView = "main" | "scores" | "board";

export interface InputActions {
  /** Current phase, read at event time. */
  getPhase: () => Phase;
  /** Current menu view, read at event time. */
  getMenuView: () => MenuView;
  onStartRun: () => void;
  onPause: () => void;
  onResume: () => void;
  onMenu: () => void;
  onToggleMute: () => void;
  onShowScores: () => void;
  onHideScores: () => void;
  onPulse: () => void;
  /** Movement keys. */
  setHeld: (dir: Dir, held: boolean) => void;
  clearHeld: () => void;
  /** Restarts are ignored for a beat after game over, so the keypress that
   *  ended the run cannot also start the next one. */
  canRestart: () => boolean;
}

const RESTART_GUARD_MS = 600;

function keyToDir(code: string): Dir | null {
  switch (code) {
    case "ArrowUp":
    case "KeyW":
      return 0;
    case "ArrowRight":
    case "KeyD":
      return 1;
    case "ArrowDown":
    case "KeyS":
      return 2;
    case "ArrowLeft":
    case "KeyA":
      return 3;
    default:
      return null;
  }
}

/** True when the event came from a field the player is typing into. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

export function useInputBindings(game: { setHeld: InputActions["setHeld"]; clearHeld: () => void }, actions: InputActions): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const phase = actions.getPhase();
      const dir = keyToDir(e.code);

      if (dir !== null) {
        e.preventDefault();
        if (phase === "playing" && !e.repeat) game.setHeld(dir, true);
        return;
      }

      switch (e.code) {
        case "Space":
        case "Enter": {
          e.preventDefault();
          if (e.repeat) return;
          if (phase === "menu") {
            if (actions.getMenuView() === "main") actions.onStartRun();
          } else if (phase === "playing") {
            actions.onPulse();
          } else if (phase === "paused") {
            actions.onResume();
          } else if (phase === "gameover" && actions.canRestart()) {
            actions.onStartRun();
          }
          break;
        }
        case "KeyE":
        case "ShiftLeft":
        case "ShiftRight":
          if (phase === "playing") actions.onPulse();
          break;
        case "KeyP":
        case "Escape":
          if (phase === "playing") actions.onPause();
          else if (phase === "paused") actions.onResume();
          else if (phase === "menu" && actions.getMenuView() === "scores") actions.onHideScores();
          break;
        case "KeyR":
          if ((phase === "gameover" || phase === "paused") && actions.canRestart()) actions.onStartRun();
          break;
        case "KeyM":
          actions.onToggleMute();
          break;
        default:
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const dir = keyToDir(e.code);
      if (dir !== null) game.setHeld(dir, false);
    };

    const onBlur = () => {
      game.clearHeld();
      actions.onPause();
    };

    const onVisibility = () => {
      if (document.hidden) {
        game.clearHeld();
        actions.onPause();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [game, actions]);
}

/** Re-exported so callers do not each re-declare the guard window. */
export const INPUT_RESTART_GUARD_MS = RESTART_GUARD_MS;
