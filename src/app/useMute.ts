/**
 * Mute preference (task 4.1).
 *
 * Extracted from `App.tsx` so the persistence detail lives in one place and the
 * composition root stops reaching into `localStorage` itself. The try/catch is
 * not defensive noise: Safari private mode throws on `setItem`, and a mute
 * button that crashes the page would be a poor trade.
 */

import { useCallback, useEffect, useState } from "react";

const MUTE_KEY = "gridbox-intelligence.muted";

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export interface UseMuteResult {
  muted: boolean;
  /** Flips the preference and persists it. */
  toggleMute: () => void;
  setMuted: (muted: boolean) => void;
}

export function useMute(): UseMuteResult {
  const [muted, setMutedState] = useState(readMuted);

  useEffect(() => {
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      /* private mode — the preference simply does not survive a reload */
    }
  }, [muted]);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
  }, []);

  const toggleMute = useCallback(() => {
    setMutedState((m) => !m);
  }, []);

  return { muted, toggleMute, setMuted };
}
