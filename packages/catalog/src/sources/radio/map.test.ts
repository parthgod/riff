import { TrackSchema } from '@riff/core';
import { describe, expect, test } from 'vitest';
import { rawStation } from './fixtures';
import { isPlayableStreamUrl, isUsableStation, mapStation } from './map';

describe('isUsableStation', () => {
  test('accepts working https, non-HLS stations only', () => {
    expect(isUsableStation(rawStation())).toBe(true);
    expect(isUsableStation(rawStation({ url_resolved: 'http://plain.test/live' }))).toBe(false);
    expect(isUsableStation(rawStation({ hls: 1 }))).toBe(false);
    expect(isUsableStation(rawStation({ lastcheckok: 0 }))).toBe(false);
    expect(isUsableStation(rawStation({ url_resolved: 'https://x.test/index.m3u8?t=1' }))).toBe(
      false,
    );
  });

  test('isPlayableStreamUrl rejects missing and playlist urls', () => {
    expect(isPlayableStreamUrl(undefined)).toBe(false);
    expect(isPlayableStreamUrl('https://x.test/master.M3U8')).toBe(false);
    expect(isPlayableStreamUrl('https://x.test/stream')).toBe(true);
  });
});

describe('mapStation', () => {
  test('maps a station to a live track', () => {
    const track = mapStation(rawStation());
    expect(track).toEqual({
      id: 'radio:9617a958-0601-11e8-ae97-52543be04c81',
      source: 'radio',
      title: 'Lofi Girl Radio',
      artists: [],
      durationSec: null,
      isLive: true,
      artwork: {
        sm: 'https://lofi.test/icon.png',
        md: 'https://lofi.test/icon.png',
        lg: 'https://lofi.test/icon.png',
      },
      genre: 'Lofi',
      permalink: 'https://lofi.test/',
    });
    expect(TrackSchema.safeParse(track).success).toBe(true);
  });

  test('drops insecure favicons and copes with missing tags and names', () => {
    const track = mapStation(
      rawStation({ favicon: 'http://x.test/i.png', tags: '', name: '  ', homepage: null }),
    );
    expect(track).toMatchObject({ title: 'Untitled station', artwork: {} });
    expect(track.genre).toBeUndefined();
    expect(track.permalink).toBeUndefined();
  });
});
