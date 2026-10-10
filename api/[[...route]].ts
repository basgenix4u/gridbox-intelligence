import { handle } from "hono/vercel";
import { createApp } from "../server/app";

/**
 * Vercel Serverless Function entry point.
 *
 * A single catch-all route keeps the whole API in one warm function, which
 * matters on Vercel: every separate file would be its own lambda with its own
 * cold start. Routing is handled inside Hono.
 */
const app = createApp();

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
