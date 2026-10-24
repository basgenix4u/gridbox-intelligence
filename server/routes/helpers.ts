import type { z } from "zod";
import type { ApiErrorCode } from "../../src/shared/contracts.js";
import { errorBody } from "../errors.js";

/**
 * The slice of Hono's context these helpers need — structural, so they stay
 * decoupled from Hono's generic context type (which the type-checked lint
 * rules treat as `any` in middleware positions).
 */
export interface ErrorContext {
  get(key: "requestId"): string | undefined;
  header(name: string, value: string): void;
  json(body: unknown, status: number): Response;
  req: { header(name: string): string | undefined; json(): Promise<unknown> };
}

/**
 * Reads a JSON body as `unknown`. Hono types `req.json()` as `any`; routing it
 * through this helper is what keeps every parsed value honestly unknown until
 * a schema has validated it.
 */
export async function readBody(req: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/** Best-effort client IP behind Vercel's proxy. */
export function clientIp(c: ErrorContext): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

/**
 * Flattens a Zod error into readable "path: message" lines for the client.
 * Used with an inline `safeParse` at each call site: the type-aware lint
 * rules cannot follow `z.output` through a generic helper, and inlining keeps
 * every parsed value properly typed without assertions.
 */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
}

export function validationError(
  c: ErrorContext,
  message: string,
  code: ApiErrorCode = "VALIDATION_FAILED",
  status = 400,
): Response {
  const requestId = c.get("requestId");
  return c.json(errorBody(code, message, undefined, requestId), status);
}

export function rateLimited(c: ErrorContext, retryAfterMs: number): Response {
  const requestId = c.get("requestId");
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  c.header("retry-after", String(seconds));
  return c.json(
    errorBody("RATE_LIMITED", `Too many requests — retry in ${seconds}s`, { retryAfterMs }, requestId),
    429,
  );
}

export function unauthorized(c: ErrorContext, message = "Missing or invalid session token"): Response {
  const requestId = c.get("requestId");
  c.header("www-authenticate", "Bearer");
  return c.json(errorBody("UNAUTHORIZED", message, undefined, requestId), 401);
}

export function serviceUnavailable(c: ErrorContext, message: string): Response {
  const requestId = c.get("requestId");
  return c.json(errorBody("SERVICE_UNAVAILABLE", message, undefined, requestId), 503);
}
