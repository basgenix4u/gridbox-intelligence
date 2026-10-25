/**
 * Persistent profile + achievement progression (task 4.1).
 *
 * Extracted from `App.tsx`, which previously did the fold-claim-queue dance
 * inline inside an engine callback — the one place in the app where a hot
 * imperative callback reached straight into four pieces of React state.
 *
 * Two rules the original got right and this keeps:
 *
 *  1. **Claiming is silent on mount.** A profile restored on a new device may
 *     already satisfy goals that were never celebrated on the old one; those
 *     are claimed without a toast, because a celebration for something the
 *     player did not just do is noise.
 *  2. **Toasts queue.** Several achievements can unlock in one run, and the
 *     toast component shows one at a time.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACHIEVEMENTS,
  markUnlocked,
  nearest,
  newlyUnlocked,
  type AchievementDef,
  type AchievementProgress,
} from "../game/achievements.js";
import { loadProfile, recordRun, saveProfile, type Profile } from "../game/profile.js";
import type { RunStats } from "../game/types.js";

const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a] as const));

export interface UseProfileResult {
  profile: Profile;
  /** The achievement currently being celebrated, or null. */
  toast: AchievementDef | null;
  /** Advances the next queued celebration, or clears when the queue is empty. */
  dismissToast: () => void;
  /** How close the player is to the next `count` goals. */
  nearest: (count: number) => AchievementProgress[];
  setAccent: (accent: string) => void;
  /**
   * Folds a finished run into the profile, claims what it unlocked and queues
   * the celebrations. Returns what the game-over screen needs to show.
   */
  record: (stats: RunStats) => { newBest: boolean; nudge: AchievementProgress | null };
}

export function useProfile(): UseProfileResult {
  // Reconciled at initialisation rather than in an effect: claiming an already
  // -satisfied goal is not a reaction to a change, it is part of loading. Doing
  // it here costs no extra render and leaves nothing for a concurrent render to
  // interleave with.
  const [profile, setProfile] = useState<Profile>(() => {
    const loaded = loadProfile();
    const pending = newlyUnlocked(loaded);
    return pending.length > 0 ? markUnlocked(loaded, pending) : loaded;
  });
  const [toast, setToast] = useState<AchievementDef | null>(null);
  const toastQueue = useRef<AchievementDef[]>([]);

  useEffect(() => {
    saveProfile(profile);
  }, [profile]);

  const dismissToast = useCallback(() => {
    setToast(toastQueue.current.shift() ?? null);
  }, []);

  const setAccent = useCallback((accent: string) => {
    setProfile((p) => ({ ...p, accent }));
  }, []);

  const record = useCallback(
    (stats: RunStats) => {
      const { profile: next, newBest } = recordRun(profile, stats, Date.now());
      const unlockedIds = newlyUnlocked(next);
      const claimed = markUnlocked(next, unlockedIds);

      const defs = unlockedIds
        .map((id) => ACHIEVEMENT_BY_ID.get(id))
        .filter((d): d is AchievementDef => d !== undefined);
      if (defs.length > 0) {
        setToast(defs[0]);
        toastQueue.current = defs.slice(1);
      }

      setProfile(claimed);
      return { newBest, nudge: nearest(claimed, 1)[0] ?? null };
    },
    [profile],
  );

  // Bound to the current profile: callers ask "what is next", not "what is
  // next for this profile I happen to be holding".
  const nearestGoals = useCallback(
    (count: number) => nearest(profile, count),
    [profile],
  );

  return { profile, toast, dismissToast, nearest: nearestGoals, setAccent, record };
}
