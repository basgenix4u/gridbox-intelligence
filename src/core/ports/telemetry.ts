/**
 * Telemetry port.
 *
 * Defaults to a no-op so the game ships with zero third-party calls. Swap in
 * a real sink (Sentry, PostHog, a Vercel function) by providing it at the
 * composition root — no feature code ever imports a vendor SDK directly.
 */
export interface Telemetry {
  captureException(error: unknown, context?: Record<string, unknown>): void;
  captureEvent(name: string, properties?: Record<string, unknown>): void;
}
