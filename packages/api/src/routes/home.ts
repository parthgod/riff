import { Hono } from 'hono';
import type { AppEnv } from '../auth';
import type { AppDeps } from '../deps';
import { composeHome } from '../library/home';

export function homeRoutes(deps: Pick<AppDeps, 'db' | 'catalog' | 'onError'>) {
  return new Hono<AppEnv>().get('/home', async (c) =>
    c.json(await composeHome(deps, c.get('user').id)),
  );
}
