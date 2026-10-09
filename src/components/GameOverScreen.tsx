import type { ScoreEntry } from "../game/highscores";
import { sanitizeName } from "../game/highscores";
import type { RunStats } from "../game/types";
import { ScoreTable } from "./ScoresPanel";
import { Button, MuteButton, Stat, formatTime } from "./ui";

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
}: Props) {
  const isHigh = rank > 0 && entryId !== null;
  const isTop = rank === 1;
  return (
    <div className="overlay">
      <div className="panel px-5 py-7 text-center sm:px-7">
        <div className="font-display text-xs font-bold tracking-[0.45em] text-rose-400">CONNECTION LOST</div>
        <h2 className="font-display breached mt-1 text-3xl font-black tracking-tight text-rose-300 sm:text-4xl">SYSTEM BREACHED</h2>

        <div className="mt-5 text-[11px] font-bold tracking-[0.3em] text-slate-400">FINAL SCORE</div>
        <div className="font-display text-5xl leading-none font-black text-white drop-shadow-[0_0_18px_rgba(34,211,238,0.35)] sm:text-6xl">
          {stats.score}
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2">
          <Stat label="LEVEL" value={stats.level} accent="#a5f3fc" />
          <Stat label="CHIPS" value={stats.chips} accent="#fde68a" />
          <Stat label="COMBO" value={`×${stats.maxCombo}`} accent="#fbbf24" />
          <Stat label="KILLS" value={stats.kills} accent="#fda4af" />
        </div>
        <div className="mt-2 text-xs font-semibold tracking-[0.2em] text-slate-500">SURVIVED {formatTime(stats.timeMs)}</div>

        {isHigh && (
          <div className="mt-5 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
            <div className="font-display text-xs font-bold tracking-[0.3em] text-amber-300">
              {isTop ? "NEW #1 HIGH SCORE" : `NEW HIGH SCORE · #${rank}`}
            </div>
            <div className="mt-2 flex items-center justify-center gap-3">
              <label htmlFor="initials" className="text-xs font-semibold tracking-[0.2em] text-slate-300">
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
          <div className="mt-3 text-[11px] font-semibold tracking-[0.15em] text-slate-500">
            <span className="kbd">ENTER</span> / <span className="kbd">R</span> RESTART INSTANTLY
          </div>
        )}

        {scores.length > 0 && (
          <div className="mt-5 text-left">
            <div className="mb-2 text-[10px] font-bold tracking-[0.25em] text-slate-400">LEADERBOARD</div>
            <ScoreTable scores={scores} highlightId={entryId} limit={5} compact />
          </div>
        )}
      </div>
    </div>
  );
}
