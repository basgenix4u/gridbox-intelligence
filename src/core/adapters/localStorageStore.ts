import type { KeyValueStore } from "@/core/ports/storage";

/**
 * `localStorage` adapter.
 *
 * Every access is guarded: Safari private mode, disabled storage and
 * quota-exceeded conditions all throw, and a game must never lose a run
 * because persistence hiccuped.
 */
export function createLocalStorageStore(): KeyValueStore {
  const backing = (): Storage | null => {
    try {
      if (typeof localStorage === "undefined") return null;
      const probe = "__gbx_probe__";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      return localStorage;
    } catch {
      return null;
    }
  };
  const store = backing();
  return {
    get: (key) => {
      if (!store) return null;
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      if (!store) return;
      try {
        store.setItem(key, value);
      } catch {
        /* quota or disabled storage — persistence is best-effort */
      }
    },
    remove: (key) => {
      if (!store) return;
      try {
        store.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
