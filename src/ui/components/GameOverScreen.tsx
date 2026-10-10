import type { ScoreEntry } from "@/game/scoring";
import { sanitizeName } from "@/game/scoring";
import type { AchievementProgress } from "@/game/achievements";
import type { RunStats } from "@/game/types";
import type { ReactElement } from "react";
import { ScoreTable } from "./ScoresPanel";
import { Button, MuteButton, Stat } from "./ui";
import { formatTime } from "../utils/format";

interface Props {
  stats: RunStats;
  rank: number;
  entryId: string | null;
  name: string;
  onNameChange: (name: string) => void;
  scores: ScoreEntry[];
  onRestart: () => void;
  onMenu: () => void;
  muted: boolean;
  onToggleMute: () => void;
  isTouch: boolean;
  /** Run set a new all-time best score (personal-best celebration). */
  newBest?: boolean;
  /** Closest unfinished achievement — the "one more run" nudge. */
  nudge?: AchievementProgress | null;
}

export function GameOverScreen({
  stats,
  rank,
  entryId,
  name,
  onNameChange,
  scores,
  onRestart,
  onMenu,
  muted,
  onToggleMute,
  isTouch,
  newBest,
  nudge,
}: Props): ReactElement {
  const isHigh = rank > 0 && entryId !== null;
  const isTop = rank === 1;
  return (
    <div className="overlay">
      <div className="panel px-5 py-7 text-center sm:px-7">
        <div className="font-display text-xs font-bold tracking-[0.45em] text-bloom-400">CONNECTION LOST</div>
        <h2 className="breached mt-1 font-display text-3xl font-black tracking-tight text-bloom-300 sm:text-4xl">
          SYSTEM BREACHED
        </h2>

        <div className="mt-5 text-[11px] font-bold tracking-[0.3em] text-veil-300">FINAL SCORE</div>
        <div className="font-display text-5xl leading-none font-black text-white drop-shadow-[0_0_18px_rgba(218,65,103,0.45)] sm:text-6xl">
          {stats.score}
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2">
          <Stat label="LEVEL" value={stats.level} accent="var(--color-bloom-300)" />
          <Stat label="CHIPS" value={stats.chips} accent="var(--color-bloom-400)" />
          <Stat label="COMBO" value={`×${stats.maxCombo}`} accent="var(--color-bloom-500)" />
          <Stat label="KILLS" value={stats.kills} accent="var(--color-veil-200)" />
        </div>
        <div className="mt-2 text-xs font-semibold tracking-[0.2em] text-veil-300">
          SURVIVED {formatTime(stats.timeMs)}
        </div>

        {newBest && (
          <div className="mt-3">
            <span className="chip row-new">
              <span aria-hidden>★</span> PERSONAL BEST
            </span>
          </div>
        )}

        {nudge && (
          <div className="mx-auto mt-4 max-w-xs rounded-xl border border-bloom-500/25 bg-bloom-500/5 px-4 py-3 text-left">
            <div className="text-[10px] font-bold tracking-[0.25em] text-bloom-400">SO CLOSE</div>
            <div className="mt-1 text-sm font-medium text-veil-200">
              Just <span className="font-display text-bloom-300">{nudge.remaining}</span> more to unlock{" "}
              <span className="font-semibold text-veil-100">{nudge.def.name}</span>.
            </div>
            <div
              className="meter mt-2"
              role="progressbar"
              aria-valuenow={nudge.current}
              aria-valuemin={0}
              aria-valuemax={nudge.target}
            >
              <div className="meter-fill" style={{ width: `${Math.round(nudge.pct * 100)}%` }} />
            </div>
          </div>
        )}

        {isHigh && (
          <div className="mt-5 rounded-xl border border-bloom-500/40 bg-bloom-500/10 px-4 py-3">
            <div className="font-display text-xs font-bold tracking-[0.3em] text-bloom-400">
              {isTop ? "NEW #1 HIGH SCORE" : `NEW HIGH SCORE · #${rank}`}
            </div>
            <div className="mt-2 flex items-center justify-center gap-3">
              <label htmlFor="initials" className="text-xs font-semibold tracking-[0.2em] text-veil-200">
                INITIALS
              </label>
              <input
                id="initials"
                className="initials"
                value={name}
                maxLength={3}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => onNameChange(sanitizeName(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onRestart();
                  }
                  e.stopPropagation();
                }}
              />
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2.5">
          <Button variant="primary" glow className="text-base" onClick={onRestart} autoFocus={!isHigh}>
            Restart
          </Button>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onMenu}>
              Main Menu
            </Button>
            <MuteButton muted={muted} onToggle={onToggleMute} />
          </div>
        </div>

        {!isTouch && (
          <div className="mt-3 text-[11px] font-semibold tracking-[0.15em] text-veil-300">
            <span className="kbd">ENTER</span> / <span className="kbd">R</span> RESTART INSTANTLY
          </div>
        )}

        {scores.length > 0 && (
          <div className="mt-5 text-left">
            <div className="mb-2 text-[10px] font-bold tracking-[0.25em] text-veil-300">LEADERBOARD</div>
            <ScoreTable scores={scores} highlightId={entryId} limit={5} compact />
          </div>
        )}
      </div>
    </div>
  );
}
