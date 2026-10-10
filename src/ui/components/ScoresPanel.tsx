import type { ReactElement } from "react";
import { useState } from "react";
import type { ScoreEntry } from "@/game/scoring";
import { MAX_SCORES } from "@/game/scoring";
import { Button } from "./ui";
import { formatDate } from "../utils/format";

interface TableProps {
  scores: ScoreEntry[];
  highlightId?: string | null;
  limit?: number;
  compact?: boolean;
}

export function ScoreTable({ scores, highlightId, limit = MAX_SCORES, compact = false }: TableProps): ReactElement {
  const rows = scores.slice(0, limit);
  if (!rows.length) {
    return (
      <div className="card border-dashed px-4 py-6 text-center text-sm font-medium text-veil-300">
        No runs recorded yet. The grid awaits.
      </div>
    );
  }
  return (
    <div className="card overflow-hidden">
      <table className="w-full table-fixed border-collapse text-left text-[13px]">
        <thead>
          <tr className="bg-ink-900/80 text-[10px] font-bold tracking-[0.2em] text-veil-300">
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
                className={`border-t border-ink-800/80 ${isNew ? "row-new text-bloom-300" : i === 0 ? "text-bloom-300" : "text-veil-200"}`}
              >
                <td className="py-1.5 pl-3 font-display text-xs font-bold text-veil-300">{i + 1}</td>
                <td className="py-1.5 font-display text-xs font-bold tracking-widest">{e.name || "---"}</td>
                <td className="py-1.5 text-right font-display text-sm font-bold">{e.score}</td>
                <td className="py-1.5 text-right font-semibold text-veil-300">{e.level}</td>
                {!compact && (
                  <td className="hidden py-1.5 text-right font-semibold text-veil-300 sm:table-cell">×{e.maxCombo}</td>
                )}
                {!compact && (
                  <td className="py-1.5 pr-3 text-right text-xs font-semibold text-veil-300">{formatDate(e.date)}</td>
                )}
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

export function ScoresPanel({ scores, onBack, onClear }: PanelProps): ReactElement {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="overlay">
      <div className="panel px-5 py-7 sm:px-7">
        <div className="text-center">
          <div className="font-display text-xs font-bold tracking-[0.45em] text-bloom-400">LOCAL</div>
          <h2 className="mt-1 font-display text-3xl font-black tracking-tight text-white">HIGH SCORES</h2>
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
