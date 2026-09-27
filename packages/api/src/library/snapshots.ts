import type { Catalog } from '@riff/catalog';
import type { Track } from '@riff/core';
import { type Db, tracks } from '@riff/db';
import { sql } from 'drizzle-orm';

/**
 * Fetches tracks through the (cached) catalog and upserts them into `tracks`, so library reads
 * never depend on an upstream. Returns them in the order asked, repeats included.
 * Rejects with the catalog's error (404 / 502 / 504) if any id fails.
 */
export async function saveTrackSnapshots(
  db: Db,
  catalog: Catalog,
  ids: readonly string[],
): Promise<Track[]> {
  const unique = [...new Set(ids)];
  const fetched = await Promise.all(unique.map((id) => catalog.getTrack(id)));
  // One row per id: ON CONFLICT cannot touch the same row twice in one statement.
  await db
    .insert(tracks)
    .values(
      fetched.map((track) => ({
        id: track.id,
        source: track.source,
        title: track.title,
        artistName: track.artists[0]?.name ?? '',
        data: track,
      })),
    )
    .onConflictDoUpdate({
      target: tracks.id,
      set: {
        source: sql`excluded.source`,
        title: sql`excluded.title`,
        artistName: sql`excluded.artist_name`,
        data: sql`excluded.data`,
        updatedAt: sql`now()`,
      },
    });
  const byId = new Map(unique.map((id, i) => [id, fetched[i]!]));
  return ids.map((id) => byId.get(id)!);
}

export async function saveTrackSnapshot(db: Db, catalog: Catalog, id: string): Promise<Track> {
  const [track] = await saveTrackSnapshots(db, catalog, [id]);
  return track!;
}
