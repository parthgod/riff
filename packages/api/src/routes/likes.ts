import { EntityIdSchema } from '@riff/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth';
import type { AppDeps } from '../deps';
import { LikesCursorSchema, like, likedTrackIds, listLikes, unlike } from '../library/likes';
import { saveTrackSnapshot } from '../library/snapshots';
import { validate } from '../validation';

const trackParam = validate('param', z.object({ trackId: EntityIdSchema }));

export function likeRoutes({ db, catalog }: Pick<AppDeps, 'db' | 'catalog'>) {
  return new Hono<AppEnv>()
    .get(
      '/me/likes',
      validate('query', z.object({ cursor: LikesCursorSchema.optional() })),
      async (c) => c.json(await listLikes(db, c.get('user').id, c.req.valid('query').cursor)),
    )
    .get('/me/likes/ids', async (c) => c.json(await likedTrackIds(db, c.get('user').id)))
    .put('/me/likes/:trackId', trackParam, async (c) => {
      const track = await saveTrackSnapshot(db, catalog, c.req.valid('param').trackId);
      await like(db, c.get('user').id, track.id);
      return c.body(null, 204);
    })
    .delete('/me/likes/:trackId', trackParam, async (c) => {
      await unlike(db, c.get('user').id, c.req.valid('param').trackId);
      return c.body(null, 204);
    });
}
