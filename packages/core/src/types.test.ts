import { describe, expect, test } from 'vitest';
import {
  CollectionSchema,
  EntityIdSchema,
  type Track,
  TrackSchema,
  TrendingWindowSchema,
} from './types';

const track: Track = {
  id: 'audius:abc',
  source: 'audius',
  title: 'Song',
  artists: [{ id: 'audius:u1', name: 'Artist' }],
  durationSec: 200,
  isLive: false,
  artwork: { md: 'https://img.test/480.jpg' },
};

describe('EntityIdSchema', () => {
  test('accepts source-prefixed ids and rejects everything else', () => {
    expect(EntityIdSchema.safeParse('audius:abc').success).toBe(true);
    expect(EntityIdSchema.safeParse('spotify:abc').success).toBe(false);
    expect(EntityIdSchema.safeParse(42).success).toBe(false);
  });
});

describe('TrackSchema', () => {
  test('accepts a regular track unchanged', () => {
    expect(TrackSchema.parse(track)).toEqual(track);
  });

  test('accepts a live track with a null duration and no artists', () => {
    const live: Track = {
      ...track,
      id: 'radio:uuid-1',
      source: 'radio',
      artists: [],
      durationSec: null,
      isLive: true,
    };
    expect(TrackSchema.safeParse(live).success).toBe(true);
  });

  test('rejects duration/live mismatches', () => {
    expect(TrackSchema.safeParse({ ...track, durationSec: null }).success).toBe(false);
    expect(TrackSchema.safeParse({ ...track, isLive: true }).success).toBe(false);
  });

  test('rejects an empty title', () => {
    expect(TrackSchema.safeParse({ ...track, title: '' }).success).toBe(false);
  });
});

describe('CollectionSchema', () => {
  test('accepts an album with tracks and no trackCount', () => {
    const album = {
      id: 'jamendo:album:7',
      source: 'jamendo',
      kind: 'album',
      title: 'LP',
      artwork: {},
      owner: { id: 'jamendo:9', name: 'Band' },
      tracks: [track],
    };
    expect(CollectionSchema.safeParse(album).success).toBe(true);
  });
});

describe('TrendingWindowSchema', () => {
  test('matches the windows Audius supports', () => {
    expect(TrendingWindowSchema.options).toEqual(['week', 'month', 'allTime']);
    expect(TrendingWindowSchema.safeParse('year').success).toBe(false);
  });
});
