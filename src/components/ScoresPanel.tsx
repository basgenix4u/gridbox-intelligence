import { useState } from "react";
import type { ScoreEntry } from "../game/highscores";
import { MAX_SCORES } from "../game/highscores";
import { Button, formatDate } from "./ui";

interface TableProps {
  scores: ScoreEntry[];
  highlightId?: string | null;
  limit?: number;
  compact?: boolean;
}

export function ScoreTable({ scores, highlightId, limit = MAX_SCORES, compact = false }: TableProps) {
  const rows = scores.slice(0, limit);
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm font-medium text-slate-500">
        No runs recorded yet. The grid awaits.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-700/60">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="bg-slate-900/80 text-[10px] font-bold tracking-[0.2em] text-slate-400">
            <th className="py-2 pl-3 font-bold">#</th>
            <th className="py-2 font-bold">NAME</th>
            <th className="py-2 text-right font-bold">SCORE</th>
            <th className="py-2 text-right font-bold">LV</th>
            {!compact && <th className="hidden py-2 text-right font-bold sm:table-cell">COMBO</th>}
            {!compact && <th className="py-2 pr-3 text-right font-bold">DATE</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => {
            const isNew = highlightId != null && e.id === highlightId;
            return (
              <tr
                key={e.id}
                className={`border-t border-slate-800/80 ${isNew ? "row-new text-amber-200" : i === 0 ? "text-cyan-100" : "text-slate-300"}`}
              >
                <td className="font-display py-1.5 pl-3 text-xs font-bold text-slate-500">{i + 1}</td>
                <td className="font-display py-1.5 text-xs font-bold tracking-widest">{e.name || "---"}</td>
                <td className="font-display py-1.5 text-right text-sm font-bold">{e.score}</td>
                <td className="py-1.5 text-right font-semibold text-slate-400">{e.level}</td>
                {!compact && <td className="hidden py-1.5 text-right font-semibold text-slate-400 sm:table-cell">×{e.maxCombo}</td>}
                {!compact && <td className="py-1.5 pr-3 text-right text-xs font-semibold text-slate-500">{formatDate(e.date)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface PanelProps {
  scores: ScoreEntry[];
  onBack: () => void;
  onClear: () => void;
}

export function ScoresPanel({ scores, onBack, onClear }: PanelProps) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="overlay">
      <div className="panel px-5 py-7 sm:px-7">
        <div className="text-center">
          <div className="font-display text-xs font-bold tracking-[0.45em] text-cyan-300">LOCAL</div>
          <h2 className="font-display mt-1 text-3xl font-black tracking-tight text-white">HIGH SCORES</h2>
        </div>
        <div className="mt-5">
          <ScoreTable scores={scores} />
        </div>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" className="flex-1" onClick={onBack} autoFocus>
            Back
          </Button>
          {scores.length > 0 && (
            <Button
              variant="danger"
              onClick={() => {
                if (confirm) {
                  onClear();
                  setConfirm(false);
                } else {
                  setConfirm(true);
                }
              }}
              onBlur={() => setConfirm(false)}
            >
              {confirm ? "Sure?" : "Clear"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
