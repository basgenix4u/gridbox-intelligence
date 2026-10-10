import type { Logger } from "@/core/ports/logger";

/** `console`-backed logger with a stable prefix. */
export function createConsoleLogger(prefix = "gridbox"): Logger {
  const emit =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string, meta?: Record<string, unknown>): void => {
      if (meta === undefined) console[level](`[${prefix}]`, message);
      else console[level](`[${prefix}]`, message, meta);
    };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}

/** Discards everything — the default in tests and on hot game paths. */
export function createSilentLogger(): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}
