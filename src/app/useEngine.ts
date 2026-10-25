/**
 * The engine instance and its imperative controls (task 4.1).
 *
 * `App.tsx` used to `new Game(...)` and `new Synth(...)` itself and then reach
 * in to poke their fields (`game.isTouch = …`, `synth.muted = …`). Every one of
 * those writes was a "value cannot be modified" lint finding, because the rule
 * is right: mutating an object a React component also holds is exactly the
 * pattern concurrent rendering punishes. This hook owns the instances and
 * exposes *verbs* instead, so the mutation lives in one auditable place.
 *
 * The instances themselves stay in `useState`, not a ref: `GameCanvas` and
 * `TouchControls` take `game` as a prop and must re-render when it appears.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "../game/engine.js";
import { Synth } from "../core/adapters/webAudio.js";
import type { RunStats } from "../game/types.js";

/** Engine default: nothing to react to. Named so the cleanup reads honestly. */
function NOOP(): void {
  /* no-op */
}

export interface EngineCallbacks {
  onGameOver: (stats: RunStats) => void;
  onChargeReady: (ready: boolean) => void;
}

export interface UseEngineResult {
  game: Game;
  synth: Synth;
  /** Unlocks audio and plays the UI blip. Must be called from a user gesture. */
  unlockAudio: () => void;
  uiBlip: () => void;
  /** Starts a run, seeding the engine's best-score hint from the local table. */
  startRun: (bestScore: number) => void;
  pause: () => void;
  resume: () => void;
  /** Returns to the attract-mode backdrop. */
  toAttract: () => void;
  /** Registers the React-side reactions to engine events. */
  setCallbacks: (callbacks: EngineCallbacks) => void;
  /** True once the platform reports a coarse pointer. */
  isTouch: boolean;
  /** True when the viewport is wider than it is tall. */
  isLandscape: boolean;
  /** Applies the reduced-motion preference. */
  setReducedMotion: (reduced: boolean) => void;
}

/** Coarse pointer, or a touch-capable device without a fine pointer. */
function detectTouch(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false;
  return coarse || "ontouchstart" in window;
}

function detectLandscape(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth > window.innerHeight;
}

export function useEngine(muted: boolean): UseEngineResult {
  const [synth] = useState(() => new Synth());
  const [game] = useState(() => new Game(synth));
  const [isTouch, setIsTouch] = useState(detectTouch);
  const [isLandscape, setIsLandscape] = useState(detectLandscape);
  // `game.callbacks` is reassigned wholesale; a ref keeps the latest closure
  // without making the listener effect below re-subscribe on every render.
  const callbacksRef = useRef<EngineCallbacks | null>(null);

  useEffect(() => {
    synth.setMuted(muted);
  }, [synth, muted]);

  useEffect(() => {
    game.setTouch(isTouch);
  }, [game, isTouch]);

  useEffect(() => {
    const query = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    game.setReducedMotion(query ? query.matches : false);
  }, [game]);

  const unlockAudio = useCallback(() => synth.unlock(), [synth]);
  const uiBlip = useCallback(() => synth.ui(), [synth]);

  const startRun = useCallback(
    (bestScore: number) => {
      synth.unlock();
      synth.ui();
      game.setBestScore(bestScore);
      game.startRun();
    },
    [game, synth],
  );

  const pause = useCallback(() => {
    game.pause();
  }, [game]);

  const resume = useCallback(() => {
    synth.unlock();
    game.resume();
  }, [synth, game]);

  const toAttract = useCallback(() => {
    synth.ui();
    game.resume();
    game.startAttract();
  }, [game, synth]);

  const setCallbacks = useCallback(
    (callbacks: EngineCallbacks) => {
      callbacksRef.current = callbacks;
    },
    [],
  );

  // One subscription for the lifetime of the engine, reading the latest
  // callbacks through the ref. The original re-assigned `game.callbacks` on
  // every dependency change, which silently dropped a callback that changed
  // between the assignment and the next engine tick.
  useEffect(() => {
    game.setCallbacks({
      onGameOver: (stats) => callbacksRef.current?.onGameOver(stats),
      onChargeReady: (ready) => callbacksRef.current?.onChargeReady(ready),
    });
    return () => {
      game.setCallbacks({ onGameOver: NOOP, onChargeReady: NOOP });
    };
  }, [game]);

  useEffect(() => {
    const onResize = () => setIsLandscape(window.innerWidth > window.innerHeight);
    const onTouch = () => setIsTouch(true);
    window.addEventListener("resize", onResize);
    // `once` is enough: a device that gains a touchscreen stays touch-capable.
    window.addEventListener("touchstart", onTouch, { passive: true, once: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("touchstart", onTouch);
    };
  }, []);

  const setReducedMotion = useCallback(
    (reduced: boolean) => {
      game.setReducedMotion(reduced);
    },
    [game],
  );

  return {
    game,
    synth,
    unlockAudio,
    uiBlip,
    startRun,
    pause,
    resume,
    toAttract,
    setCallbacks,
    isTouch,
    isLandscape,
    setReducedMotion,
  };
}
