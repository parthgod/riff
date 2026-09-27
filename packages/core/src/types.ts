import { z } from 'zod';
import { type EntityId, isEntityId, SOURCE_IDS } from './ids';

export const SourceIdSchema = z.enum(SOURCE_IDS);

export const EntityIdSchema = z.custom<EntityId>(
  (value) => typeof value === 'string' && isEntityId(value),
  'Invalid entity id',
);

/** Roughly 150 / 480 / 1000 px square images. */
export const ArtworkSchema = z.object({
  sm: z.string().optional(),
  md: z.string().optional(),
  lg: z.string().optional(),
});
export type Artwork = z.infer<typeof ArtworkSchema>;

export const ArtistRefSchema = z.object({ id: EntityIdSchema, name: z.string() });
export type ArtistRef = z.infer<typeof ArtistRefSchema>;

export const TrackSchema = z
  .object({
    id: EntityIdSchema,
    source: SourceIdSchema,
    title: z.string().min(1),
    /** Primary artist first. Empty for radio stations. */
    artists: z.array(ArtistRefSchema),
    album: z.object({ id: EntityIdSchema, title: z.string() }).optional(),
    /** null exactly when the track is a live stream. */
    durationSec: z.number().nonnegative().nullable(),
    isLive: z.boolean(),
    artwork: ArtworkSchema,
    genre: z.string().optional(),
    mood: z.string().optional(),
    bpm: z.number().positive().optional(),
    releaseDate: z.string().optional(),
    playCount: z.number().int().nonnegative().optional(),
    /** Attribution link to the track's page on its source. */
    permalink: z.string().optional(),
  })
  .refine(
    (track) => (track.durationSec === null) === track.isLive,
    'durationSec must be null exactly when isLive is true',
  );
export type Track = z.infer<typeof TrackSchema>;

export const ArtistSchema = z.object({
  id: EntityIdSchema,
  source: SourceIdSchema,
  name: z.string(),
  handle: z.string().optional(),
  avatar: ArtworkSchema,
  banner: z.string().optional(),
  bio: z.string().optional(),
  followerCount: z.number().int().nonnegative().optional(),
  trackCount: z.number().int().nonnegative().optional(),
  verified: z.boolean(),
});
export type Artist = z.infer<typeof ArtistSchema>;

/** A playlist or album that lives on a source (user playlists live in the DB). */
export const CollectionSchema = z.object({
  id: EntityIdSchema,
  source: SourceIdSchema,
  kind: z.enum(['playlist', 'album']),
  title: z.string(),
  description: z.string().optional(),
  artwork: ArtworkSchema,
  owner: ArtistRefSchema,
  trackCount: z.number().int().nonnegative().optional(),
  tracks: z.array(TrackSchema).optional(),
});
export type Collection = z.infer<typeof CollectionSchema>;

export const LyricLineSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  text: z.string(),
});
export type LyricLine = z.infer<typeof LyricLineSchema>;

export const LyricsSchema = z.object({
  synced: z.array(LyricLineSchema).nullable(),
  plain: z.string().nullable(),
  instrumental: z.boolean(),
});
export type Lyrics = z.infer<typeof LyricsSchema>;

export const StreamInfoSchema = z.object({
  url: z.string(),
  /** Alternate URLs for the same audio, tried in order when `url` fails. */
  mirrors: z.array(z.string()),
  live: z.boolean(),
});
export type StreamInfo = z.infer<typeof StreamInfoSchema>;

export const TRENDING_WINDOWS = ['week', 'month', 'allTime'] as const;
export const TrendingWindowSchema = z.enum(TRENDING_WINDOWS);
export type TrendingWindow = z.infer<typeof TrendingWindowSchema>;
