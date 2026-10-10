/**
 * Persistence port.
 *
 * Isolates the domain from `localStorage` so the scoring layer can be unit
 * tested without a DOM, and so a different backend (IndexedDB, a server
 * sync, an in-memory stub for tests) can be substituted without touching
 * a single line of game logic.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
