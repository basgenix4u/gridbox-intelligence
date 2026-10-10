/**
 * Base error type for the application.
 *
 * Distinguishes errors we raised deliberately (safe to surface to a user or
 * map to an HTTP status) from unexpected ones (report to telemetry, show a
 * generic message). `code` is a stable machine-readable string, never a
 * human sentence.
 */
export class AppError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    // Restore the prototype chain — required when targeting ES5/ES2015 downlevels.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/** Narrowing helper for `catch (e)` blocks, where `e` is `unknown`. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toErrorMessage(error: unknown): string {
  if (isAppError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}
