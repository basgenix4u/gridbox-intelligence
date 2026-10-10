import type { AudioSink } from "@/core/ports/audio";

/** Audio sink that produces nothing — used by headless tests and the harness. */
export function createSilentAudio(): AudioSink {
  return {
    unlock: () => undefined,
    muted: true,
    gameSounds: false,
    collect: () => undefined,
    move: () => undefined,
    bump: () => undefined,
    hit: () => undefined,
    death: () => undefined,
    pulse: () => undefined,
    kill: () => undefined,
    ready: () => undefined,
    levelUp: () => undefined,
    spawn: () => undefined,
    deny: () => undefined,
    ui: () => undefined,
    gameOver: () => undefined,
  };
}
