import type { Artist } from '@riff/core';
import { type Db, followedArtists } from '@riff/db';
import { and, desc, eq, sql } from 'drizzle-orm';

/** Stores (or refreshes) the artist snapshot; following again keeps the original follow time. */
export async function follow(db: Db, userId: string, artist: Artist): Promise<void> {
  await db
    .insert(followedArtists)
    .values({ userId, artistId: artist.id, data: artist })
    .onConflictDoUpdate({
      target: [followedArtists.userId, followedArtists.artistId],
      set: { data: sql`excluded.data` },
    });
}

export async function unfollow(db: Db, userId: string, artistId: string): Promise<void> {
  await db
    .delete(followedArtists)
    .where(and(eq(followedArtists.userId, userId), eq(followedArtists.artistId, artistId)));
}

/** Most recently followed first. */
export async function listFollowing(db: Db, userId: string, limit?: number): Promise<Artist[]> {
  const query = db
    .select({ artist: followedArtists.data })
    .from(followedArtists)
    .where(eq(followedArtists.userId, userId))
    .orderBy(desc(followedArtists.createdAt), desc(followedArtists.artistId));
  const rows = limit === undefined ? await query : await query.limit(limit);
  return rows.map((row) => row.artist);
}
