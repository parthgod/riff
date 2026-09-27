import { EntityIdSchema } from '@riff/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth';
import type { AppDeps } from '../deps';
import {
  appendEntries,
  assertOwnsPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  moveEntry,
  removeEntry,
  updatePlaylist,
} from '../library/playlists';
import { saveTrackSnapshots } from '../library/snapshots';
import { validate } from '../validation';

const name = z.string().trim().min(1).max(100);
/** Blank descriptions are stored as null. */
const description = z
  .string()
  .trim()
  .max(300)
  .nullable()
  .transform((value) => value || null);

const playlistParam = validate('param', z.object({ id: z.uuid() }));
const entryParam = validate('param', z.object({ id: z.uuid(), entryId: z.uuid() }));

export function playlistRoutes({ db, catalog }: Pick<AppDeps, 'db' | 'catalog'>) {
  return new Hono<AppEnv>()
    .get('/me/playlists', async (c) => c.json(await listPlaylists(db, c.get('user').id)))
    .post(
      '/me/playlists',
      validate('json', z.object({ name, description: description.optional() })),
      async (c) => c.json(await createPlaylist(db, c.get('user').id, c.req.valid('json')), 201),
    )
    .get('/playlists/:id', playlistParam, async (c) =>
      c.json(await getPlaylist(db, c.get('user').id, c.req.valid('param').id)),
    )
    .patch(
      '/me/playlists/:id',
      playlistParam,
      validate(
        'json',
        z
          .object({
            name: name.optional(),
            description: description.optional(),
            isPublic: z.boolean().optional(),
          })
          .refine(
            (patch) => Object.values(patch).some((v) => v !== undefined),
            'Nothing to change',
          ),
      ),
      async (c) =>
        c.json(
          await updatePlaylist(db, c.get('user').id, c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete('/me/playlists/:id', playlistParam, async (c) => {
      await deletePlaylist(db, c.get('user').id, c.req.valid('param').id);
      return c.body(null, 204);
    })
    .post(
      '/me/playlists/:id/tracks',
      playlistParam,
      validate('json', z.object({ trackIds: z.array(EntityIdSchema).min(1).max(100) })),
      async (c) => {
        const userId = c.get('user').id;
        const { id } = c.req.valid('param');
        // Check ownership before any upstream call, so a foreign playlist is a plain 404.
        await assertOwnsPlaylist(db, userId, id);
        const items = await saveTrackSnapshots(db, catalog, c.req.valid('json').trackIds);
        return c.json({ entries: await appendEntries(db, userId, id, items) }, 201);
      },
    )
    .patch(
      '/me/playlists/:id/tracks/:entryId',
      entryParam,
      validate('json', z.object({ afterEntryId: z.uuid().nullable() })),
      async (c) => {
        const { id, entryId } = c.req.valid('param');
        await moveEntry(db, c.get('user').id, id, entryId, c.req.valid('json').afterEntryId);
        return c.body(null, 204);
      },
    )
    .delete('/me/playlists/:id/tracks/:entryId', entryParam, async (c) => {
      const { id, entryId } = c.req.valid('param');
      await removeEntry(db, c.get('user').id, id, entryId);
      return c.body(null, 204);
    });
}
