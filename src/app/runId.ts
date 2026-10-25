/**
 * Collision-resistant run id (task 4.1).
 *
 * Extracted from `App.tsx` so the composition root does not carry a crypto
 * fallback. `randomUUID` is available everywhere this runs, but a non-secure
 * context is still possible and an unhandled `undefined` would be worse than a
 * timestamp.
 */

export function createRunId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
