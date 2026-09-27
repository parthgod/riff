import { EntityIdSchema } from '@riff/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth';
import type { AppDeps } from '../deps';
import { recentTracks, recordPlay } from '../library/history';
import { saveTrackSnapshot } from '../library/snapshots';
import { limitParam, validate } from '../validation';

const DAY_MS = 86_400_000;

export function historyRoutes({ db, catalog }: Pick<AppDeps, 'db' | 'catalog'>) {
  return new Hono<AppEnv>()
    .post(
      '/me/history',
      validate(
        'json',
        z.object({
          trackId: EntityIdSchema,
          msPlayed: z.number().int().min(0).max(DAY_MS),
          context: z.string().trim().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const play = c.req.valid('json');
        const track = await saveTrackSnapshot(db, catalog, play.trackId);
        await recordPlay(db, c.get('user').id, { ...play, trackId: track.id });
        return c.body(null, 204);
      },
    )
    .get(
      '/me/history/recent',
      validate('query', z.object({ limit: limitParam(50, 20) })),
      async (c) => c.json(await recentTracks(db, c.get('user').id, c.req.valid('query').limit)),
    );
}
