import type { EntityId, Track } from '@riff/core';
import { type Db, likedTracks, tracks } from '@riff/db';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { z } from 'zod';

export const LIKES_PAGE_SIZE = 50;

export interface LikedTrack {
  track: Track;
  likedAt: string;
}

export interface LikesPage {
  items: LikedTrack[];
  /** Pass back as `?cursor=` for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

interface Cursor {
  likedAt: Date;
  trackId: string;
}

/** `<likedAt epoch ms>_<trackId>`: the keyset position of the last item on a page. */
export const LikesCursorSchema = z
  .string()
  .regex(/^\d{1,15}_.+$/, 'Invalid cursor')
  .transform((value): Cursor => {
    const split = value.indexOf('_');
    return {
      likedAt: new Date(Number(value.slice(0, split))),
      trackId: value.slice(split + 1),
    };
  });

const encodeCursor = ({ likedAt, trackId }: Cursor) => `${likedAt.getTime()}_${trackId}`;

export async function like(db: Db, userId: string, trackId: string): Promise<void> {
  await db.insert(likedTracks).values({ userId, trackId }).onConflictDoNothing();
}

export async function unlike(db: Db, userId: string, trackId: string): Promise<void> {
  await db
    .delete(likedTracks)
    .where(and(eq(likedTracks.userId, userId), eq(likedTracks.trackId, trackId)));
}

/** Newest first. Ties on likedAt are broken by track id, so pages never skip or repeat. */
export async function listLikes(db: Db, userId: string, cursor?: Cursor): Promise<LikesPage> {
  const rows = await db
    .select({ track: tracks.data, trackId: likedTracks.trackId, likedAt: likedTracks.createdAt })
    .from(likedTracks)
    .innerJoin(tracks, eq(tracks.id, likedTracks.trackId))
    .where(
      and(
        eq(likedTracks.userId, userId),
        cursor &&
          or(
            lt(likedTracks.createdAt, cursor.likedAt),
            and(eq(likedTracks.createdAt, cursor.likedAt), lt(likedTracks.trackId, cursor.trackId)),
          ),
      ),
    )
    .orderBy(desc(likedTracks.createdAt), desc(likedTracks.trackId))
    .limit(LIKES_PAGE_SIZE + 1);

  const page = rows.slice(0, LIKES_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({ track: row.track, likedAt: row.likedAt.toISOString() })),
    nextCursor: rows.length > LIKES_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

export async function likedTrackIds(db: Db, userId: string): Promise<EntityId[]> {
  const rows = await db
    .select({ trackId: likedTracks.trackId })
    .from(likedTracks)
    .where(eq(likedTracks.userId, userId))
    .orderBy(desc(likedTracks.createdAt), desc(likedTracks.trackId));
  return rows.map((row) => row.trackId as EntityId);
}
