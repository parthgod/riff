import type { Track } from '@riff/core';
import { type Db, playlists, playlistTracks, tracks } from '@riff/db';
import { and, asc, desc, eq, gt, ne, or, sql } from 'drizzle-orm';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { notFound } from '../errors';

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  /** null: the UI renders a mosaic of `covers`. */
  coverUrl: string | null;
  isPublic: boolean;
  trackCount: number;
  /** Artwork of the first (up to) four entries that have any, in playlist order. */
  covers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistEntry {
  /** Entry id (a track may appear more than once). */
  id: string;
  track: Track;
  addedAt: string;
}

export interface PlaylistDetail extends PlaylistSummary {
  ownerId: string;
  isOwner: boolean;
  entries: PlaylistEntry[];
}

export interface PlaylistPatch {
  name?: string;
  description?: string | null;
  isPublic?: boolean;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A track's cover for mosaics: the ~480 px artwork, else whatever size exists. */
const COVER_SQL = sql.raw(
  "coalesce(t.data->'artwork'->>'md', t.data->'artwork'->>'sm', t.data->'artwork'->>'lg')",
);

const summaryColumns = {
  id: playlists.id,
  ownerId: playlists.ownerId,
  name: playlists.name,
  description: playlists.description,
  coverUrl: playlists.coverUrl,
  isPublic: playlists.isPublic,
  createdAt: playlists.createdAt,
  updatedAt: playlists.updatedAt,
  // Plain SQL: Drizzle renders columns unqualified in single-table selects, which would make
  // `playlists.id` ambiguous inside these correlated subqueries.
  trackCount: sql<number>`(
    select count(*) from playlist_tracks pt where pt.playlist_id = playlists.id
  )`.mapWith(Number),
  covers: sql<string[]>`coalesce((
    select array_agg(firsts.cover order by firsts.position) from (
      select ${COVER_SQL} as cover, pt.position
      from playlist_tracks pt join tracks t on t.id = pt.track_id
      where pt.playlist_id = playlists.id and ${COVER_SQL} is not null
      order by pt.position
      limit 4
    ) firsts
  ), '{}')`,
};

interface SummaryRow {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  isPublic: boolean;
  trackCount: number;
  covers: string[];
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(row: SummaryRow): PlaylistSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coverUrl: row.coverUrl,
    isPublic: row.isPublic,
    trackCount: row.trackCount,
    covers: row.covers,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findSummary(db: Db | Tx, id: string, ownerId: string): Promise<PlaylistSummary> {
  const [row] = await db
    .select(summaryColumns)
    .from(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.ownerId, ownerId)));
  if (!row) throw notFound('No such playlist');
  return toSummary(row);
}

/** Locks the playlist row so concurrent edits of one playlist are serialised. */
async function lockOwned(tx: Tx, ownerId: string, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: playlists.id })
    .from(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.ownerId, ownerId)))
    .for('update');
  if (!row) throw notFound('No such playlist');
}

async function touch(tx: Tx, id: string): Promise<void> {
  await tx.update(playlists).set({ updatedAt: sql`now()` }).where(eq(playlists.id, id));
}

/** The user's playlists, most recently changed first. */
export async function listPlaylists(db: Db, ownerId: string): Promise<PlaylistSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(playlists)
    .where(eq(playlists.ownerId, ownerId))
    .orderBy(desc(playlists.updatedAt), desc(playlists.createdAt));
  return rows.map(toSummary);
}

export async function createPlaylist(
  db: Db,
  ownerId: string,
  input: { name: string; description?: string | null },
): Promise<PlaylistSummary> {
  const [row] = await db
    .insert(playlists)
    .values({ ownerId, name: input.name, description: input.description ?? null })
    .returning({ id: playlists.id });
  return findSummary(db, row!.id, ownerId);
}

/** Visible to its owner, or to any signed-in user when public. */
export async function getPlaylist(db: Db, viewerId: string, id: string): Promise<PlaylistDetail> {
  const [row] = await db
    .select(summaryColumns)
    .from(playlists)
    .where(
      and(eq(playlists.id, id), or(eq(playlists.ownerId, viewerId), eq(playlists.isPublic, true))),
    );
  if (!row) throw notFound('No such playlist');

  const entries = await db
    .select({ id: playlistTracks.id, track: tracks.data, addedAt: playlistTracks.addedAt })
    .from(playlistTracks)
    .innerJoin(tracks, eq(tracks.id, playlistTracks.trackId))
    .where(eq(playlistTracks.playlistId, id))
    .orderBy(asc(playlistTracks.position));

  return {
    ...toSummary(row),
    ownerId: row.ownerId,
    isOwner: row.ownerId === viewerId,
    entries: entries.map((entry) => ({ ...entry, addedAt: entry.addedAt.toISOString() })),
  };
}

export async function updatePlaylist(
  db: Db,
  ownerId: string,
  id: string,
  patch: PlaylistPatch,
): Promise<PlaylistSummary> {
  const updated = await db
    .update(playlists)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(playlists.id, id), eq(playlists.ownerId, ownerId)))
    .returning({ id: playlists.id });
  if (updated.length === 0) throw notFound('No such playlist');
  return findSummary(db, id, ownerId);
}

export async function deletePlaylist(db: Db, ownerId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.ownerId, ownerId)))
    .returning({ id: playlists.id });
  if (deleted.length === 0) throw notFound('No such playlist');
}

/** Throws 404 unless `ownerId` owns the playlist; cheap pre-check before upstream calls. */
export async function assertOwnsPlaylist(db: Db, ownerId: string, id: string): Promise<void> {
  await findSummary(db, id, ownerId);
}

/** Appends tracks (already snapshotted) in the given order after the current last entry. */
export async function appendEntries(
  db: Db,
  ownerId: string,
  playlistId: string,
  items: readonly Track[],
): Promise<PlaylistEntry[]> {
  return db.transaction(async (tx) => {
    await lockOwned(tx, ownerId, playlistId);
    const [last] = await tx
      .select({ position: playlistTracks.position })
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId))
      .orderBy(desc(playlistTracks.position))
      .limit(1);
    const keys = generateNKeysBetween(last?.position ?? null, null, items.length);
    const rows = await tx
      .insert(playlistTracks)
      .values(items.map((track, i) => ({ playlistId, trackId: track.id, position: keys[i]! })))
      .returning({ id: playlistTracks.id, addedAt: playlistTracks.addedAt });
    await touch(tx, playlistId);
    return rows.map((row, i) => ({
      id: row.id,
      track: items[i]!,
      addedAt: row.addedAt.toISOString(),
    }));
  });
}

/** Moves an entry to just after `afterEntryId` (null = to the top). Only one row changes. */
export async function moveEntry(
  db: Db,
  ownerId: string,
  playlistId: string,
  entryId: string,
  afterEntryId: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwned(tx, ownerId, playlistId);
    const position = async (id: string) => {
      const [row] = await tx
        .select({ position: playlistTracks.position })
        .from(playlistTracks)
        .where(and(eq(playlistTracks.id, id), eq(playlistTracks.playlistId, playlistId)));
      if (!row) throw notFound('No such playlist entry');
      return row.position;
    };

    await position(entryId);
    if (afterEntryId === entryId) return;
    const lower = afterEntryId === null ? null : await position(afterEntryId);
    const [next] = await tx
      .select({ position: playlistTracks.position })
      .from(playlistTracks)
      .where(
        and(
          eq(playlistTracks.playlistId, playlistId),
          ne(playlistTracks.id, entryId),
          lower === null ? undefined : gt(playlistTracks.position, lower),
        ),
      )
      .orderBy(asc(playlistTracks.position))
      .limit(1);

    await tx
      .update(playlistTracks)
      .set({ position: generateKeyBetween(lower, next?.position ?? null) })
      .where(eq(playlistTracks.id, entryId));
    await touch(tx, playlistId);
  });
}

export async function removeEntry(
  db: Db,
  ownerId: string,
  playlistId: string,
  entryId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwned(tx, ownerId, playlistId);
    const deleted = await tx
      .delete(playlistTracks)
      .where(and(eq(playlistTracks.id, entryId), eq(playlistTracks.playlistId, playlistId)))
      .returning({ id: playlistTracks.id });
    if (deleted.length === 0) throw notFound('No such playlist entry');
    await touch(tx, playlistId);
  });
}
