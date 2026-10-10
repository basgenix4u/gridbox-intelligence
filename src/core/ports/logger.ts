/**
 * Logging port.
 *
 * Keeps domain and server code free of `console` so output can be silenced in
 * tests, prefixed in development, or shipped to an aggregator later without a
 * single call-site change.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
