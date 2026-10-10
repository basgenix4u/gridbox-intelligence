import type { ReactElement } from "react";
import { useEffect } from "react";
import type { AchievementDef } from "@/game/achievements";

interface Props {
  achievement: AchievementDef;
  onDone: () => void;
}

/** How long a single unlock stays on screen. */
const TOAST_MS = 3400;

/**
 * Unlock celebration.
 *
 * Completion and collection are the strongest "one more run" drivers in the
 * motivation research (Yee 2006; Quantic Foundry 2016) — the moment an unlock
 * lands is the game's loudest positive feedback and deserves to interrupt.
 * Auto-dismisses on a timer; `role="status"` so screen readers hear it without
 * stealing focus.
 */
export function AchievementToast({ achievement, onDone }: Props): ReactElement {
  useEffect(() => {
    const t = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div className="toast-pop flex max-w-xs items-center gap-3 rounded-2xl border border-bloom-500/50 px-4 py-3 shadow-2xl">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bloom-500/20 text-xl text-bloom-300"
        >
          {achievement.glyph}
        </span>
        <div className="min-w-0 text-left">
          <div className="font-display text-[10px] font-bold tracking-[0.3em] text-bloom-400">UNLOCKED</div>
          <div className="truncate font-display text-sm font-bold text-veil-100">{achievement.name}</div>
          <div className="truncate text-xs text-veil-300">{achievement.desc}</div>
        </div>
      </div>
    </div>
  );
}
