import type { ReactElement } from "react";
import { KINDS } from "@/game/constants";
import { Button, MuteButton } from "./ui";

interface Props {
  onPlay: () => void;
  onScores: () => void;
  muted: boolean;
  onToggleMute: () => void;
  best: number | null;
  isTouch: boolean;
}

export function StartScreen({ onPlay, onScores, muted, onToggleMute, best, isTouch }: Props): ReactElement {
  return (
    <div className="overlay">
      <div className="panel px-6 py-7 text-center sm:px-8">
        <div className="mb-4 flex justify-center">
          <div className="logo-grid" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        </div>

        <h1 className="title-grad font-display text-[2.6rem] leading-none font-black tracking-tight sm:text-5xl">
          GRIDBOX
        </h1>
        <div className="mt-2 font-display text-xs font-bold tracking-[0.45em] text-amber-300 sm:text-sm">
          INTELLIGENCE
        </div>
        <p className="mx-auto mt-4 max-w-xs text-base leading-snug font-medium text-slate-300">
          Harvest data chips. Outsmart the machines. <span className="text-cyan-300">Pulse</span> to purge them.
        </p>

        {best !== null && (
          <div className="mt-3 text-xs font-semibold tracking-[0.25em] text-slate-400">
            BEST <span className="font-display text-amber-300">{best}</span>
          </div>
        )}

        <div className="mt-6 flex flex-col items-center gap-3">
          <Button variant="primary" glow className="w-full max-w-[260px] text-base" onClick={onPlay} autoFocus>
            Play
          </Button>
          <div className="flex w-full max-w-[260px] gap-2">
            <Button className="flex-1" onClick={onScores}>
              High Scores
            </Button>
            <MuteButton muted={muted} onToggle={onToggleMute} />
          </div>
          <div className="text-[11px] font-semibold tracking-[0.2em] text-slate-500">
            {isTouch ? "TAP PLAY TO START" : "PRESS ENTER TO START"}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-2 text-left text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <div className="mb-1.5 text-[10px] font-bold tracking-[0.25em] text-cyan-300">MOVE</div>
            {isTouch ? (
              <div className="font-medium text-slate-300">Swipe the grid or use the D-pad. Hold to keep moving.</div>
            ) : (
              <div className="flex flex-wrap items-center gap-1 font-medium text-slate-300">
                <span className="kbd">W</span>
                <span className="kbd">A</span>
                <span className="kbd">S</span>
                <span className="kbd">D</span>
                <span className="mx-1 text-slate-500">or</span>
                <span className="kbd">↑</span>
                <span className="kbd">←</span>
                <span className="kbd">↓</span>
                <span className="kbd">→</span>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <div className="mb-1.5 text-[10px] font-bold tracking-[0.25em] text-cyan-300">PULSE</div>
            <div className="font-medium text-slate-300">
              {isTouch ? (
                <>
                  Tap <span className="font-display text-xs text-cyan-200">PULSE</span>
                </>
              ) : (
                <>
                  <span className="kbd">SPACE</span>
                </>
              )}{" "}
              after 5 chips to purge every machine within 2 cells.
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-left text-sm font-medium text-slate-300">
          <span className="text-amber-300">Chain chips quickly</span> to build a combo multiplier — up to ×8. Getting
          hit resets it.
        </div>

        <div className="mt-4 text-left">
          <div className="mb-2 text-[10px] font-bold tracking-[0.25em] text-slate-400">THREAT TIERS</div>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {KINDS.map((k) => (
              <li key={k.name} className="flex items-center gap-2.5 text-xs">
                <span
                  className="inline-block h-3.5 w-3.5 shrink-0 rounded-[4px]"
                  style={{ background: k.color, boxShadow: `0 0 10px ${k.color}88` }}
                />
                <span
                  className="w-14 shrink-0 font-display text-[10px] font-bold tracking-wider"
                  style={{ color: k.color }}
                >
                  {k.name}
                </span>
                <span className="leading-tight font-medium text-slate-400">{k.desc}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
