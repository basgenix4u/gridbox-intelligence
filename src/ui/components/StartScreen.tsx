import type { ReactElement } from "react";
import { ACCENTS, KINDS } from "@/game/constants";
import type { AchievementProgress } from "@/game/achievements";
import type { Profile } from "@/game/profile";
import { Button, MuteButton } from "./ui";
import { ProgressRail } from "./ProgressRail";

interface Props {
  onPlay: () => void;
  onScores: () => void;
  muted: boolean;
  onToggleMute: () => void;
  best: number | null;
  isTouch: boolean;
  /** Meta-progression; omitted in bare renders (tests) → journey card hidden. */
  profile?: Profile;
  /** Closest-to-done achievements, nearest first (goal-gradient order). */
  nearest?: AchievementProgress[];
  onAccent?: (id: string) => void;
}

function streakLine(profile: Profile): string {
  const { current } = profile.streak;
  if (current >= 2) return `${current}-day streak`;
  if (current === 1) return "streak started";
  return "start a streak";
}

export function StartScreen({
  onPlay,
  onScores,
  muted,
  onToggleMute,
  best,
  isTouch,
  profile,
  nearest,
  onAccent,
}: Props): ReactElement {
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

        <h1 className="title-grad font-display leading-none font-black tracking-tight">GRIDBOX</h1>
        <div className="mt-2 font-display text-xs font-bold tracking-[0.45em] text-bloom-400 sm:text-sm">
          INTELLIGENCE
        </div>
        <p className="mx-auto mt-4 max-w-xs text-base leading-snug font-medium text-veil-200">
          Harvest data chips. Outsmart the machines. <span className="text-bloom-400">Pulse</span> to purge them.
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {best !== null && (
            <div className="text-xs font-semibold tracking-[0.25em] text-veil-300">
              BEST <span className="font-display text-bloom-400">{best}</span>
            </div>
          )}
          {profile &&
            (profile.streak.current > 0 ? (
              <span className="chip" title="Consecutive days with at least one run">
                <span aria-hidden>◆</span> {streakLine(profile)}
              </span>
            ) : (
              <span className="chip chip-quiet">
                <span aria-hidden>◆</span> {streakLine(profile)}
              </span>
            ))}
        </div>

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
          <div className="text-[11px] font-semibold tracking-[0.2em] text-veil-300">
            {isTouch ? "TAP PLAY TO START" : "PRESS ENTER TO START"}
          </div>
        </div>

        {profile && nearest && nearest.length > 0 && (
          <div className="card card-accent mt-6 p-3 text-left">
            <div className="mb-2 text-[10px] font-bold tracking-[0.22em] text-bloom-400">SO CLOSE</div>
            <ul className="flex flex-col gap-2.5">
              {nearest.map((pr) => (
                <ProgressRail key={pr.def.id} progress={pr} />
              ))}
            </ul>
          </div>
        )}

        {profile && (
          <div className="card mt-3 flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="text-[10px] font-bold tracking-[0.25em] text-veil-300">YOUR LOOK</div>
            <div className="flex gap-2" role="radiogroup" aria-label="Player colour">
              {ACCENTS.map((a) => {
                const selected = profile.accent === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={a.label}
                    title={a.label}
                    onClick={() => onAccent?.(a.id)}
                    className={`h-7 w-7 cursor-pointer rounded-full border-2 transition-transform ${
                      selected ? "scale-110 border-veil-100" : "border-ink-700 hover:scale-105"
                    }`}
                    style={{ background: a.player, boxShadow: selected ? `0 0 12px ${a.player}aa` : "none" }}
                  />
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-2 text-left text-sm sm:grid-cols-2">
          <div className="card p-3">
            <div className="mb-1.5 text-[10px] font-bold tracking-[0.22em] text-veil-300">MOVE</div>
            {isTouch ? (
              <div className="font-medium text-veil-200">Swipe the grid or use the D-pad. Hold to keep moving.</div>
            ) : (
              <div className="flex flex-wrap items-center gap-1 font-medium text-veil-200">
                <span className="kbd">W</span>
                <span className="kbd">A</span>
                <span className="kbd">S</span>
                <span className="kbd">D</span>
                <span className="mx-1 text-veil-300">or</span>
                <span className="kbd">↑</span>
                <span className="kbd">←</span>
                <span className="kbd">↓</span>
                <span className="kbd">→</span>
              </div>
            )}
          </div>
          <div className="card p-3">
            <div className="mb-1.5 text-[10px] font-bold tracking-[0.22em] text-veil-300">PULSE</div>
            <div className="font-medium text-veil-200">
              {isTouch ? (
                <>
                  Tap <span className="font-display text-xs text-bloom-300">PULSE</span>
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

        <div className="card card-accent mt-3 p-3 text-left text-sm font-medium text-veil-200">
          <span className="text-bloom-400">Chain chips quickly</span> to build a combo multiplier — up to ×8. Getting
          hit resets it.
        </div>

        <div className="mt-4 text-left">
          <div className="mb-2 text-[10px] font-bold tracking-[0.25em] text-veil-300">THREAT TIERS</div>
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
                <span className="leading-tight font-medium text-veil-300">{k.desc}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
