import { describe, expect, test } from 'vitest';
import { createHttpClient } from '../http';
import { type FakeRoute, fakeFetch } from '../testing/fake-fetch';
import { cleanTitle, createLrclibClient, type LrclibRecord, pickBest } from './lrclib';

const record = (overrides: Partial<LrclibRecord> = {}): LrclibRecord => ({
  id: 1,
  trackName: 'One More Time',
  artistName: 'Daft Punk',
  albumName: 'Discovery',
  duration: 320,
  instrumental: false,
  plainLyrics: 'One more time',
  syncedLyrics: '[00:30.75] One more time',
  ...overrides,
});

function setup(routes: FakeRoute[]) {
  const fetch = fakeFetch(routes);
  const client = createLrclibClient({
    http: createHttpClient({ fetch, userAgent: 'ua' }),
    baseUrl: 'https://lrclib.test',
  });
  return { client, fetch, url: (i = 0) => new URL(fetch.requests[i]!.url) };
}

describe('createLrclibClient().getLyrics', () => {
  test('returns parsed lyrics from an exact match', async () => {
    const { client, url } = setup([{ match: '/api/get', json: record() }]);
    const lyrics = await client.getLyrics({
      title: 'One More Time',
      artist: 'Daft Punk',
      album: 'Discovery',
      durationSec: 320.4,
    });
    expect(lyrics).toEqual({
      synced: [{ timeMs: 30_750, text: 'One more time' }],
      plain: 'One more time',
      instrumental: false,
    });
    expect(Object.fromEntries(url().searchParams)).toEqual({
      track_name: 'One More Time',
      artist_name: 'Daft Punk',
      album_name: 'Discovery',
      duration: '320',
    });
  });

  test('falls back to search with a cleaned title and picks the closest synced candidate', async () => {
    const { client, url } = setup([
      { match: '/api/get', status: 404, json: { code: 404, name: 'TrackNotFound' } },
      {
        match: '/api/search',
        json: [
          record({ id: 2, duration: 250, syncedLyrics: '[00:01.00] far away' }),
          record({ id: 3, duration: 321, syncedLyrics: null, plainLyrics: 'plain only' }),
          record({ id: 4, duration: 318, syncedLyrics: '[00:02.00] close' }),
        ],
      },
    ]);
    const lyrics = await client.getLyrics({
      title: 'Daft Punk - One More Time (Official Video)',
      artist: 'Daft Punk',
      durationSec: 320,
    });
    expect(lyrics?.synced).toEqual([{ timeMs: 2_000, text: 'close' }]);
    expect(url(1).searchParams.get('track_name')).toBe('One More Time');
    expect(url(1).searchParams.get('artist_name')).toBe('Daft Punk');
  });

  test('skips an exact match that has no lyrics at all', async () => {
    const { client } = setup([
      { match: '/api/get', json: record({ syncedLyrics: null, plainLyrics: null }) },
      { match: '/api/search', json: [] },
    ]);
    expect(await client.getLyrics({ title: 'x', artist: 'y' })).toBeNull();
  });

  test('reports instrumentals', async () => {
    const { client } = setup([
      {
        match: '/api/get',
        json: record({ instrumental: true, syncedLyrics: null, plainLyrics: null }),
      },
    ]);
    expect(await client.getLyrics({ title: 'x', artist: 'y' })).toEqual({
      synced: null,
      plain: null,
      instrumental: true,
    });
  });
});

describe('cleanTitle', () => {
  test('strips an artist prefix, feature credits and video/remaster noise', () => {
    expect(cleanTitle('Daft Punk - One More Time (Official Video)', 'Daft Punk')).toBe(
      'One More Time',
    );
    expect(cleanTitle('Song (feat. Someone)', 'A')).toBe('Song');
    expect(cleanTitle('Song ft. Someone', 'A')).toBe('Song');
    expect(cleanTitle('Song [Remastered 2011]', 'A')).toBe('Song');
  });

  test('keeps meaningful bracketed parts and never returns an empty string', () => {
    expect(cleanTitle('Title (Remix)', 'A')).toBe('Title (Remix)');
    expect(cleanTitle('(Official Video)', 'A')).toBe('(Official Video)');
  });
});

describe('pickBest', () => {
  test('ignores the duration filter when the duration is unknown', () => {
    expect(pickBest([record({ id: 9, duration: 999 })], null)?.id).toBe(9);
    expect(pickBest([record({ duration: 999 })], 100)).toBeNull();
  });
});
