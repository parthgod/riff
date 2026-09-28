import { createApiFromEnv } from '@riff/api';

// Built on the first request rather than at import, so `next build` needs no runtime env vars.
// One instance per server process: one DB pool (max 5) and one catalog cache.
// This is what `hono/vercel`'s `handle(app)` does, plus the lazy construction.
let api: ReturnType<typeof createApiFromEnv> | undefined;

function handler(request: Request): Response | Promise<Response> {
  api ??= createApiFromEnv(process.env);
  return api.app.fetch(request);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
