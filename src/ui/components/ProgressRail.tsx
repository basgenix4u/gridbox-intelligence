import type { ReactElement } from "react";
import type { AchievementProgress } from "@/game/achievements";

interface Props {
  progress: AchievementProgress;
}

/**
 * One achievement progress bar.
 *
 * The fill and the numeric badge both carry the state (not colour alone), the
 * meter is `aria`-labelled with the numbers, and the copy emphasises what is
 * *left* — goal-gradient framing (Kivetz 2006): motivation tracks proportional
 * distance to a visible goal.
 */
export function ProgressRail({ progress }: Props): ReactElement {
  const { def, current, target, pct, remaining } = progress;
  const pctText = `${Math.round(pct * 100)}%`;
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden className="w-5 shrink-0 text-center text-base leading-none text-bloom-400">
        {def.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-semibold text-veil-200">{def.name}</span>
          <span className="shrink-0 font-display text-[10px] font-bold text-veil-300">
            {current}/{target}
          </span>
        </div>
        <div
          className="meter mt-1"
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-label={`${def.name}: ${current} of ${target}`}
        >
          <div className="meter-fill" style={{ width: pctText }} />
        </div>
        {remaining > 0 && pct >= 0.2 && (
          <div className="mt-0.5 text-[10px] text-veil-300">
            just <span className="font-display text-bloom-400">{remaining}</span> to go
          </div>
        )}
      </div>
    </li>
  );
}
