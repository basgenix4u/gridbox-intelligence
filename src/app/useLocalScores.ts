/**
 * The local high-score table (task 4.1).
 *
 * Extracted from `App.tsx`. The table is the source of truth for the *local*
 * game and stays that way: a server outage must not erase a score the player
 * actually earned, so runs are recorded here first and mirrored to the API
 * afterwards (see `useVerifiedRun`).
 *
 * `loadScores` is called lazily in the `useState` initialiser rather than at
 * module scope, which is what keeps importing this hook safe under SSR and in
 * tests.
 */

import { useCallback, useState } from "react";
import {
  addScore,
  clearScores,
  loadScores,
  updateName,
  type ScoreEntry,
} from "../game/scoring.js";

export interface RecordResult {
  /** The entry's id when it made the table, else null. */
  entryId: string | null;
  /** 1-based position, or -1 when the run did not make the cut. */
  rank: number;
}

export interface UseLocalScoresResult {
  /** Newest-first, exactly as `game/scoring` returns it. */
  scores: ScoreEntry[];
  /** Records a finished run and reports where it landed. */
  record: (entry: ScoreEntry) => RecordResult;
  /** Renames an entry in place — used by the game-over name field. */
  renameEntry: (entryId: string, name: string) => void;
  clear: () => void;
  /** Best score on the board, or null when the table is empty. */
  best: number | null;
}

export function useLocalScores(): UseLocalScoresResult {
  const [scores, setScores] = useState<ScoreEntry[]>(loadScores);

  const record = useCallback((entry: ScoreEntry): RecordResult => {
    // `addScore` returns the list it persisted plus the rank it reached; a rank
    // of -1 means the run did not make the cut and has no id worth keeping.
    const { list, rank } = addScore(entry);
    setScores(list);
    return { entryId: rank > 0 ? entry.id : null, rank };
  }, []);

  const renameEntry = useCallback((entryId: string, name: string) => {
    setScores(updateName(entryId, name));
  }, []);

  const clear = useCallback(() => {
    setScores(clearScores());
  }, []);

  return { scores, record, renameEntry, clear, best: scores.length ? scores[0].score : null };
}
