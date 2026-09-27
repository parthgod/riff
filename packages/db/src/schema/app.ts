import type { Artist, Track } from '@riff/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Fractional-index keys must sort byte-wise. The cluster default collation (for example
 * en_US.UTF-8) orders "aZ" after "aa", which would scramble playlists past ~36 entries.
 */
const byteOrderedText = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });

/** Millisecond precision, so values round-trip through JS Dates (keyset cursors compare them). */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

const userId = () =>
  text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

/** Catalog snapshots: library reads never depend on an upstream being up. */
export const tracks = pgTable(
  'tracks',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    title: text('title').notNull(),
    artistName: text('artist_name').notNull(),
    data: jsonb('data').$type<Track>().notNull(),
    updatedAt: timestamptz('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('tracks_search_trgm_idx').using(
      'gin',
      sql`(${t.title} || ' ' || ${t.artistName}) gin_trgm_ops`,
    ),
  ],
);

export const likedTracks = pgTable(
  'liked_tracks',
  {
    userId: userId(),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.trackId] }),
    index('liked_tracks_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
);

export const playlists = pgTable(
  'playlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    isPublic: boolean('is_public').default(false).notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at').defaultNow().notNull(),
  },
  (t) => [index('playlists_owner_idx').on(t.ownerId)],
);

export const playlistTracks = pgTable(
  'playlist_tracks',
  {
    /** Entry id: the same track may appear several times in one playlist. */
    id: uuid('id').primaryKey().defaultRandom(),
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    position: byteOrderedText('position').notNull(),
    addedAt: timestamptz('added_at').defaultNow().notNull(),
  },
  (t) => [unique('playlist_tracks_playlist_position_key').on(t.playlistId, t.position)],
);

export const playHistory = pgTable(
  'play_history',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: userId(),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    playedAt: timestamptz('played_at').defaultNow().notNull(),
    msPlayed: integer('ms_played').notNull(),
    context: text('context'),
  },
  (t) => [index('play_history_user_played_idx').on(t.userId, t.playedAt.desc())],
);

export const followedArtists = pgTable(
  'followed_artists',
  {
    userId: userId(),
    artistId: text('artist_id').notNull(),
    data: jsonb('data').$type<Artist>().notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.artistId] })],
);
