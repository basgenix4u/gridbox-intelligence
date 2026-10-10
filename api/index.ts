/**
 * Vercel entry point for the API.
 *
 * Dynamic filename segments (`api/[...route].ts`) are a Next.js feature — with
 * `framework: "vite"` Vercel maps filenames to routes literally, so a bracketed
 * catch-all never matches. Instead this file is the single serverless function
 * and `vercel.json` rewrites `/api/v1/*` to it.
 *
 * Hono declares its routes as `/v1/*`, but the request retains its original
 * path (`/api/v1/healthz`) after the rewrite, so the `/api` prefix is stripped
 * before dispatch. Normalising here keeps the handler correct whichever form
 * Vercel hands us.
 *
 * @module api/index
 */

import { createApp } from "../server/app";

const app = createApp();

/** Rewrites `/api/v1/healthz` to `/v1/healthz` so Hono's routes match. */
export function stripApiPrefix(url: URL): URL {
  if (!url.pathname.startsWith("/api")) return url;
  const path = url.pathname.slice("/api".length) || "/";
  return new URL(path + url.search, url.origin);
}

function handler(req: Request): Response | Promise<Response> {
  return app.fetch(new Request(stripApiPrefix(new URL(req.url)), req));
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
