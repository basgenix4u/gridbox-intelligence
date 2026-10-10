/**
 * Presentation formatters.
 *
 * Kept out of `ui/components/ui.tsx` deliberately: mixing non-component
 * exports into a component file breaks Fast Refresh, which silently degrades
 * the development experience.
 */

/** `92_000` -> `"1:32"`. */
export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Epoch ms -> `"Oct 9"`. */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
