import { Hono } from 'hono';
import { type AppEnv, requireUser } from './auth';
import { noStoreByDefault } from './cache-control';
import { type AppDeps, reportError } from './deps';
import { ApiError, errorBody, toApiError } from './errors';
import { catalogRoutes } from './routes/catalog';
import { likeRoutes } from './routes/likes';
import { meRoutes } from './routes/me';
import { playlistRoutes } from './routes/playlists';

/** Every route, relative to /api. `AppType` (for `hc`) is derived from this. */
export function apiRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use('*', noStoreByDefault)
    .get('/health', (c) => c.json({ ok: true as const }))
    .on(['GET', 'POST'], '/auth/*', (c) => deps.auth.handler(c.req.raw))
    .use('*', requireUser(deps.auth))
    .route('/', catalogRoutes(deps.catalog))
    .route('/', meRoutes())
    .route('/', likeRoutes(deps))
    .route('/', playlistRoutes(deps));
}

export type AppType = ReturnType<typeof apiRoutes>;

/** The API mounted at /api, with the error contract applied to every route. */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath('/api');
  app.onError((error, c) => {
    const apiError = toApiError(error);
    if (apiError.code === 'INTERNAL') reportError(deps, error, `${c.req.method} ${c.req.path}`);
    c.header('Cache-Control', 'no-store');
    return c.json(errorBody(apiError), apiError.status);
  });
  app.notFound((c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(errorBody(new ApiError('NOT_FOUND', 'No such route')), 404);
  });
  app.route('/', apiRoutes(deps));
  return app;
}
