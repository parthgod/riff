import type { Track } from '@riff/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  followedArtists,
  likedTracks,
  playHistory,
  playlists,
  playlistTracks,
  tracks,
  user,
} from './schema';
import { createTestDb, migrateTestDatabase, truncateAll } from './testing';

const { db, close } = createTestDb();

beforeAll(async () => {
  await migrateTestDatabase();
  await truncateAll(db);
});
afterAll(() => close());

const track: Track = {
  id: 'audius:t1',
  source: 'audius',
  title: 'Track 1',
  artists: [{ id: 'audius:a1', name: 'Artist' }],
  durationSec: 180,
  isLive: false,
  artwork: {},
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Runs `body` in a transaction that is always rolled back. */
async function inRollback(body: (tx: Tx) => Promise<void>): Promise<void> {
  const rollback = new Error('rollback');
  await db
    .transaction(async (tx) => {
      await body(tx);
      throw rollback;
    })
    .catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
}

describe('migrations', () => {
  test('are idempotent', async () => {
    await expect(migrateTestDatabase()).resolves.toBeUndefined();
  });

  test('install pg_trgm and the library-search trigram index', async () => {
    const indexes = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'tracks_search_trgm_idx'`,
    );
    expect(indexes[0]?.indexdef).toContain('gin_trgm_ops');
  });

  test('store playlist positions with byte-wise ("C") collation', async () => {
    const columns = await db.execute<{ collation_name: string | null }>(
      sql`select collation_name from information_schema.columns
          where table_name = 'playlist_tracks' and column_name = 'position'`,
    );
    expect(columns[0]?.collation_name).toBe('C');
  });
});

describe('schema', () => {
  test('deleting a user cascades to their library but keeps track snapshots', async () => {
    await inRollback(async (tx) => {
      await tx.insert(user).values({ id: 'u1', name: 'U', email: 'u1@example.com' });
      await tx.insert(tracks).values({
        id: track.id,
        source: 'audius',
        title: track.title,
        artistName: 'Artist',
        data: track,
      });
      const [playlist] = await tx
        .insert(playlists)
        .values({ ownerId: 'u1', name: 'Mix' })
        .returning();
      await tx.insert(playlistTracks).values({
        playlistId: playlist!.id,
        trackId: track.id,
        position: 'a0',
      });
      await tx.insert(likedTracks).values({ userId: 'u1', trackId: track.id });
      await tx.insert(playHistory).values({ userId: 'u1', trackId: track.id, msPlayed: 30_000 });
      await tx.insert(followedArtists).values({
        userId: 'u1',
        artistId: 'audius:a1',
        data: {
          id: 'audius:a1',
          source: 'audius',
          name: 'Artist',
          avatar: {},
          verified: false,
        },
      });

      await tx.delete(user).where(eq(user.id, 'u1'));

      for (const table of [playlists, playlistTracks, likedTracks, playHistory, followedArtists]) {
        expect(await tx.$count(table)).toBe(0);
      }
      expect(await tx.$count(tracks)).toBe(1);
    });
  });

  test('orders fractional keys byte-wise, unlike the default collation', async () => {
    await inRollback(async (tx) => {
      await tx.insert(user).values({ id: 'u1', name: 'U', email: 'u1@example.com' });
      await tx.insert(tracks).values({
        id: track.id,
        source: 'audius',
        title: track.title,
        artistName: 'Artist',
        data: track,
      });
      const [playlist] = await tx
        .insert(playlists)
        .values({ ownerId: 'u1', name: 'Mix' })
        .returning();
      await tx.insert(playlistTracks).values(
        ['aa', 'aZ', 'a9'].map((position) => ({
          playlistId: playlist!.id,
          trackId: track.id,
          position,
        })),
      );
      const rows = await tx
        .select({ position: playlistTracks.position })
        .from(playlistTracks)
        .orderBy(playlistTracks.position);
      expect(rows.map((row) => row.position)).toEqual(['a9', 'aZ', 'aa']);
    });
  });
});
