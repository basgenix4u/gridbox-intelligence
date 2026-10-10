import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { AppError, isAppError } from "../src/core/errors/AppError.js";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/** Statuses Hono accepts for a response that carries a body. */
const CONTENTFUL_STATUSES = new Set([
  200, 201, 202, 203, 204, 206, 301, 302, 303, 304, 307, 308, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410,
  411, 412, 413, 414, 415, 416, 417, 418, 422, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504, 505, 507, 508,
  510, 511,
]);

/**
 * Narrows an arbitrary number to a status Hono will accept, falling back to
 * 400. Without this, one bad status in an error path turns a clean 400 into a
 * 500 with a confusing message.
 */
function asStatus(value: unknown, fallback = 400): ContentfulStatusCode {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || !CONTENTFUL_STATUSES.has(n)) return fallback as ContentfulStatusCode;
  return n as ContentfulStatusCode;
}

/**
 * Single error shape for the whole API: a stable machine-readable `code` for
 * clients, plus a human message. Internal exception text never leaves the
 * server.
 */
export function errorBody(code: string, message: string, details?: unknown, requestId?: string): ApiErrorBody {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      ...(requestId ? { requestId } : {}),
    },
  };
}

export function onError(err: Error, c: Context): Response {
  const requestId = c.get("requestId") as string | undefined;

  if (err instanceof HTTPException) {
    return c.json(errorBody("HTTP_ERROR", err.message, undefined, requestId), err.status);
  }

  if (isAppError(err)) {
    const status = asStatus((err.details as { status?: unknown } | undefined)?.status);
    return c.json(errorBody(err.code, err.message, undefined, requestId), status);
  }

  // Unexpected: log the detail server-side, return nothing specific.

  console.error("[api] unhandled error", { requestId, message: err.message, stack: err.stack });
  return c.json(errorBody("INTERNAL_ERROR", "An unexpected error occurred.", undefined, requestId), 500);
}

/** Raises a typed failure carrying the HTTP status it should map to. */
export function fail(code: string, message: string, status = 400, details?: unknown): AppError {
  return new AppError(code, message, { status, ...(details ? { details } : {}) });
}

/** Reads the status back off an AppError raised by `fail`. */
export function statusOf(err: unknown): ContentfulStatusCode {
  if (isAppError(err)) return asStatus((err.details as { status?: unknown } | undefined)?.status);
  return 500;
}
