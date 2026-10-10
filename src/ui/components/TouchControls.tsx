import type { ReactElement } from "react";
import type { Game } from "@/game/engine";
import type { Dir } from "@/game/types";

export const TOUCH_H = 206;
export const TOUCH_W = 236;

interface Props {
  game: Game;
  pulseReady: boolean;
  landscape: boolean;
  onPause: () => void;
  onUnlockAudio: () => void;
}

const ROT = [0, 90, 180, 270];

function Chevron({ dir }: { dir: Dir }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" style={{ transform: `rotate(${ROT[dir]}deg)` }} aria-hidden>
      <path
        d="M6 15l6-6 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TouchControls({ game, pulseReady, landscape, onPause, onUnlockAudio }: Props): ReactElement {
  const bind = (dir: Dir) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      onUnlockAudio();
      game.setHeld(dir, true);
    },
    onPointerUp: () => game.setHeld(dir, false),
    onPointerCancel: () => game.setHeld(dir, false),
    onPointerLeave: () => game.setHeld(dir, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const labels = ["Move up", "Move right", "Move down", "Move left"];
  const dirBtn = (dir: Dir) => (
    <button type="button" className="dpad-btn" aria-label={labels[dir]} {...bind(dir)}>
      <Chevron dir={dir} />
    </button>
  );

  return (
    <div
      className={`flex items-center justify-center gap-7 select-none ${landscape ? "flex-col" : "flex-row"}`}
      style={landscape ? { width: TOUCH_W - 20 } : { height: TOUCH_H - 16 }}
    >
      <div className="grid grid-cols-3 grid-rows-3 gap-1.5">
        <span />
        {dirBtn(0)}
        <span />
        {dirBtn(3)}
        <span className="flex items-center justify-center">
          <span className="h-3 w-3 rounded-sm bg-bloom-500/30" />
        </span>
        {dirBtn(1)}
        <span />
        {dirBtn(2)}
        <span />
      </div>

      <div className={`flex items-center gap-3 ${landscape ? "flex-row" : "flex-col"}`}>
        <button type="button" className="small-btn" aria-label="Pause" onClick={onPause}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
            <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
            <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className={`pulse-btn ${pulseReady ? "ready" : ""}`}
          aria-label="Fire pulse"
          onPointerDown={(e) => {
            e.preventDefault();
            onUnlockAudio();
            game.inputPulse();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          PULSE
        </button>
      </div>
    </div>
  );
}
