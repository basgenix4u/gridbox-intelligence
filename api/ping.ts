/** Minimal diagnostic: confirms Vercel is building the /api directory. */
export function GET(): Response {
  return new Response(JSON.stringify({ pong: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
