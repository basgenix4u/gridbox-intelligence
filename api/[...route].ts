import { handle } from "hono/vercel";
import { createApp } from "../server/app";

/**
 * Vercel Serverless Function entry point.
 *
 * A single catch-all route keeps the whole API in one warm function, which
 * matters on Vercel: every separate file would be its own lambda with its own
 * cold start. Routing is handled inside Hono.
 *
 * The app is mounted at `/api` because Vercel invokes this function with the
 * full path (`/api/v1/healthz`), while the routes are declared without it.
 */
const app = createApp({ basePath: "/api" });

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
