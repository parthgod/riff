import { EntityIdSchema } from '@riff/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth';
import type { AppDeps } from '../deps';
import { follow, listFollowing, unfollow } from '../library/following';
import { validate } from '../validation';

const artistParam = validate('param', z.object({ artistId: EntityIdSchema }));

export function followingRoutes({ db, catalog }: Pick<AppDeps, 'db' | 'catalog'>) {
  return new Hono<AppEnv>()
    .get('/me/following', async (c) => c.json(await listFollowing(db, c.get('user').id)))
    .put('/me/following/:artistId', artistParam, async (c) => {
      const artist = await catalog.getArtist(c.req.valid('param').artistId);
      await follow(db, c.get('user').id, artist);
      return c.body(null, 204);
    })
    .delete('/me/following/:artistId', artistParam, async (c) => {
      await unfollow(db, c.get('user').id, c.req.valid('param').artistId);
      return c.body(null, 204);
    });
}
