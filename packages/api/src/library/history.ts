import type { Track } from '@riff/core';
import { type Db, playHistory, tracks } from '@riff/db';
import { desc, eq, max } from 'drizzle-orm';

export async function recordPlay(
  db: Db,
  userId: string,
  play: { trackId: string; msPlayed: number; context?: string },
): Promise<void> {
  await db.insert(playHistory).values({
    userId,
    trackId: play.trackId,
    msPlayed: play.msPlayed,
    context: play.context ?? null,
  });
}

/** Distinct tracks, most recently played first. */
export async function recentTracks(db: Db, userId: string, limit: number): Promise<Track[]> {
  const lastPlays = db
    .select({
      trackId: playHistory.trackId,
      lastPlayedAt: max(playHistory.playedAt).as('last_played_at'),
    })
    .from(playHistory)
    .where(eq(playHistory.userId, userId))
    .groupBy(playHistory.trackId)
    .as('last_plays');
  const rows = await db
    .select({ track: tracks.data })
    .from(lastPlays)
    .innerJoin(tracks, eq(tracks.id, lastPlays.trackId))
    .orderBy(desc(lastPlays.lastPlayedAt), desc(tracks.id))
    .limit(limit);
  return rows.map((row) => row.track);
}
