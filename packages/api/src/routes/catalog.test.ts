import { CatalogError } from '@riff/catalog';
import { GENRES } from '@riff/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { okSources } from '../testing/fake-catalog';
import { makeArtist, makeTrack } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
});

describe('GET /search', () => {
  test('passes the query and limit to the catalog and returns its result', async () => {
    const res = await alice.get('/search?q=lofi%20beats&limit=5');
    expect(res.status).toBe(200);
    expect(api.catalog.search).toHaveBeenCalledWith('lofi beats', { limit: 5 });
    expect(await res.json()).toEqual({
      tracks: [],
      artists: [],
      collections: [],
      stations: [],
      sources: okSources,
    });
  });

  test('defaults the limit to 20 and keeps Unicode and URL-special characters intact', async () => {
    await alice.get(`/search?q=${encodeURIComponent('AC/DC & Beyoncé')}`);
    expect(api.catalog.search).toHaveBeenCalledWith('AC/DC & Beyoncé', { limit: 20 });
  });

  test('is privately cacheable for half the server TTL (5 min -> 150 s)', async () => {
    const res = await alice.get('/search?q=x');
    expect(res.headers.get('cache-control')).toBe('private, max-age=150');
  });

  test('a partial result (a source failed) is cacheable only briefly', async () => {
    api.catalog.search.mockResolvedValueOnce({
      tracks: [],
      artists: [],
      collections: [],
      stations: [],
      sources: { ...okSources, audius: 'timeout' },
    });
    const res = await alice.get('/search?q=x');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=15');
  });

  test.each([
    ['missing q', '/search'],
    ['limit 0', '/search?q=x&limit=0'],
    ['limit above 50', '/search?q=x&limit=51'],
    ['fractional limit', '/search?q=x&limit=2.5'],
    ['non-numeric limit', '/search?q=x&limit=ten'],
    ['empty limit', '/search?q=x&limit='],
    ['query over 200 characters', `/search?q=${'a'.repeat(201)}`],
  ])('rejects %s with 400 and never calls the catalog', async (_, path) => {
    const res = await alice.get(path);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toMatch(/^(q|limit): /);
    expect(api.catalog.search).not.toHaveBeenCalled();
  });
});

describe('GET /trending', () => {
  test('defaults to this week and 30 tracks', async () => {
    const res = await alice.get('/trending');
    expect(res.status).toBe(200);
    expect(api.catalog.trending).toHaveBeenCalledWith({ window: 'week', limit: 30 });
    expect(await res.json()).toEqual({ tracks: [], sources: okSources });
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
  });

  test('passes genre and window through', async () => {
    await alice.get(`/trending?genre=${encodeURIComponent('Hip-Hop/Rap')}&window=allTime&limit=10`);
    expect(api.catalog.trending).toHaveBeenCalledWith({
      genre: 'Hip-Hop/Rap',
      window: 'allTime',
      limit: 10,
    });
  });

  test('rejects an unknown window', async () => {
    expect((await alice.get('/trending?window=year')).status).toBe(400);
  });
});

test('GET /genres returns the genre list', async () => {
  const res = await alice.get('/genres');
  expect(await res.json()).toEqual([...GENRES]);
});

describe('entity routes', () => {
  test('GET /tracks/:id returns the track, with plain or percent-encoded colons', async () => {
    const track = makeTrack(1);
    api.catalog.addTracks(track);
    for (const path of ['/tracks/audius:t1', '/tracks/audius%3At1']) {
      const res = await alice.get(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(track);
      expect(res.headers.get('cache-control')).toBe('private, max-age=1800');
    }
  });

  test('ids with several colons reach the catalog whole', async () => {
    await alice.get('/collections/jamendo:album:42');
    expect(api.catalog.getCollection).toHaveBeenCalledWith('jamendo:album:42');
  });

  test('unknown ids are 404 with the error body and no-store', async () => {
    const res = await alice.get('/tracks/audius:nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Nothing found for audius:nope' },
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test.each([
    ['UPSTREAM_ERROR', 502],
    ['UPSTREAM_TIMEOUT', 504],
  ] as const)('an upstream %s becomes %i', async (code, status) => {
    api.catalog.getArtist.mockRejectedValueOnce(new CatalogError(code, 'Audius is down'));
    const res = await alice.get('/artists/audius:a1');
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: { code, message: 'Audius is down' } });
  });

  test('unexpected failures are 500 with a generic message and get reported', async () => {
    api.catalog.getTrack.mockRejectedValueOnce(new TypeError('cannot read x of undefined'));
    const res = await alice.get('/tracks/audius:t1');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong' },
    });
    expect(api.errors).toHaveLength(1);
  });

  test('artist tracks and related artists take a bounded limit', async () => {
    api.catalog.addArtists(makeArtist(1));
    api.catalog.setArtistTracks('audius:a1', [makeTrack(1), makeTrack(2), makeTrack(3)]);

    const tracks = await alice.get('/artists/audius:a1/tracks?limit=2');
    expect((await tracks.json()).map((t: { id: string }) => t.id)).toEqual([
      'audius:t1',
      'audius:t2',
    ]);
    await alice.get('/artists/audius:a1/related');
    expect(api.catalog.getRelatedArtists).toHaveBeenCalledWith('audius:a1', { limit: 10 });
    expect((await alice.get('/artists/audius:a1/tracks?limit=500')).status).toBe(400);
  });
});

describe('GET /tracks/:id/lyrics', () => {
  test('returns lyrics when the catalog has them', async () => {
    api.catalog.addTracks(makeTrack(1));
    const lyrics = { synced: [{ timeMs: 0, text: 'hi' }], plain: 'hi', instrumental: false };
    api.catalog.setLyrics('audius:t1', lyrics);
    const res = await alice.get('/tracks/audius:t1/lyrics');
    expect(await res.json()).toEqual(lyrics);
    expect(res.headers.get('cache-control')).toBe('private, max-age=43200');
  });

  test('is 404 when no lyrics exist', async () => {
    api.catalog.addTracks(makeTrack(1));
    const res = await alice.get('/tracks/audius:t1/lyrics');
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe('No lyrics for this track');
  });
});

describe('GET /stream/:id', () => {
  test('redirects to the resolved URL and is never cached', async () => {
    api.catalog.addTracks(makeTrack(1));
    const res = await alice.get('/stream/audius:t1');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cdn.example/audius:t1.mp3');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('?format=json returns the StreamInfo for mirror fallback', async () => {
    api.catalog.addTracks(makeTrack(1));
    const res = await alice.get('/stream/audius:t1?format=json');
    expect(await res.json()).toEqual({
      url: 'https://cdn.example/audius:t1.mp3',
      mirrors: [],
      live: false,
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('rejects other formats', async () => {
    expect((await alice.get('/stream/audius:t1?format=xml')).status).toBe(400);
  });
});

describe('radio', () => {
  test('GET /radio/top passes tag and limit', async () => {
    await alice.get('/radio/top?tag=jazz&limit=5');
    expect(api.catalog.radioTop).toHaveBeenCalledWith({ tag: 'jazz', limit: 5 });
  });

  test('GET /radio/search searches by name, or lists a tag when only a tag is given', async () => {
    await alice.get('/radio/search?q=fip');
    expect(api.catalog.radioSearch).toHaveBeenCalledWith('fip', { limit: 30 });
    await alice.get('/radio/search?tag=ambient');
    expect(api.catalog.radioTop).toHaveBeenCalledWith({ tag: 'ambient', limit: 30 });
  });

  test('GET /radio/search without q or tag is 400', async () => {
    const res = await alice.get('/radio/search?q=%20%20');
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Pass q or tag');
  });
});
