import { CACHE_TTL, type SourceStatuses } from '@riff/catalog';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

/** Default for every response; catalog GETs opt in to caching with `cacheFor`. */
export const noStoreByDefault = createMiddleware(async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

/** Half the server-side TTL; `private` because every catalog route requires a session. */
export function cacheFor(c: Context, ttlMs: number): void {
  c.header('Cache-Control', `private, max-age=${Math.floor(ttlMs / 2000)}`);
}

/** Search and trending results where a source failed are retried soon, on both sides. */
export const fanOutTtl = (sources: SourceStatuses, ttlMs: number): number =>
  Object.values(sources).some((status) => status === 'error' || status === 'timeout')
    ? CACHE_TTL.partial
    : ttlMs;
