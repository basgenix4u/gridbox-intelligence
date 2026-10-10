/* eslint-disable no-console -- this sink exists precisely to write to the console. */

import type { Telemetry } from "@/core/ports/telemetry";

/** Default sink: captures nothing, calls nothing, ships no vendor code. */
export function createNoopTelemetry(): Telemetry {
  return {
    captureException: () => undefined,
    captureEvent: () => undefined,
  };
}

/**
 * Console sink for local development. Stays out of production bundles
 * because it is only ever referenced from the dev composition root.
 */
export function createConsoleTelemetry(): Telemetry {
  return {
    captureException: (error, context) => {
      console.error("[telemetry] exception", error, context ?? {});
    },
    captureEvent: (name, properties) => {
      console.info("[telemetry] event", name, properties ?? {});
    },
  };
}
