import { describe, expect, test } from 'vitest';
import { createHttpClient } from '../../http';
import { type FakeRoute, fakeFetch } from '../../testing/fake-fetch';
import { createJamendoAdapter } from './adapter';
import { jamendoOk, rawJamendoAlbum, rawJamendoArtist, rawJamendoTrack } from './fixtures';

function setup(routes: FakeRoute[]) {
  const fetch = fakeFetch(routes);
  const adapter = createJamendoAdapter({
    http: createHttpClient({ fetch, userAgent: 'ua' }),
    config: { clientId: 'cid', apiUrl: 'https://api.jamendo.test/v3.0' },
  });
  return { adapter, fetch, url: (i = 0) => new URL(fetch.requests[i]!.url) };
}

describe('jamendo adapter', () => {
  test('searchTracks sends credentials and track params and drops unstreamable tracks', async () => {
    const { adapter, url } = setup([
      {
        match: '/v3.0/tracks/',
        json: jamendoOk([rawJamendoTrack(), rawJamendoTrack({ id: '2', audio: '' })]),
      },
    ]);
    const tracks = await adapter.searchTracks('sunny side', { limit: 7 });
    expect(tracks.map((t) => t.id)).toEqual(['jamendo:1886257']);
    expect(url().pathname).toBe('/v3.0/tracks/');
    expect(Object.fromEntries(url().searchParams)).toMatchObject({
      client_id: 'cid',
      format: 'json',
      search: 'sunny side',
      limit: '7',
      include: 'musicinfo',
      audioformat: 'mp32',
    });
  });

  test('turns a failed response header into UPSTREAM_ERROR', async () => {
    const { adapter } = setup([
      {
        match: '/v3.0/tracks/',
        json: {
          headers: {
            status: 'failed',
            code: 5,
            error_message: 'Invalid Client Id',
            results_count: 0,
          },
          results: [],
        },
      },
    ]);
    await expect(adapter.searchTracks('x', { limit: 1 })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'jamendo: Invalid Client Id',
    });
  });

  test('trending maps the window to a popularity order and the genre to a tag', async () => {
    const { adapter, url } = setup([
      { match: '/v3.0/tracks/', json: jamendoOk([rawJamendoTrack()]) },
    ]);
    await adapter.trending!({ genre: 'Hip-Hop/Rap', window: 'allTime', limit: 5 });
    expect(url().searchParams.get('order')).toBe('popularity_total');
    expect(url().searchParams.get('tags')).toBe('hiphop');
    await adapter.trending!({ limit: 5 });
    expect(url(1).searchParams.get('order')).toBe('popularity_week');
    expect(url(1).searchParams.has('tags')).toBe(false);
  });

  test('getTrack, getArtist and getArtistTracks', async () => {
    const { adapter, url } = setup([
      { match: 'id=missing', json: jamendoOk([]) },
      { match: '/v3.0/artists/', json: jamendoOk([rawJamendoArtist()]) },
      { match: '/v3.0/tracks/', json: jamendoOk([rawJamendoTrack()]) },
    ]);
    expect((await adapter.getTrack('1886257'))?.id).toBe('jamendo:1886257');
    expect(url(0).searchParams.get('id')).toBe('1886257');
    expect(await adapter.getTrack('missing')).toBeNull();
    expect((await adapter.getArtist!('7872'))?.name).toBe('Ketsa');
    await adapter.getArtistTracks!('7872', { limit: 10 });
    expect(url(3).searchParams.get('artist_id')).toBe('7872');
    expect(url(3).searchParams.get('order')).toBe('popularity_total');
  });

  test('getArtistTracks can list the newest tracks instead of the most popular', async () => {
    const { adapter, url } = setup([
      { match: '/v3.0/tracks/', json: jamendoOk([rawJamendoTrack()]) },
    ]);
    await adapter.getArtistTracks!('7872', { limit: 5, sort: 'newest' });
    expect(url().searchParams.get('order')).toBe('releasedate_desc');
  });

  test('getCollection loads album tracks and ignores non-album ids', async () => {
    const { adapter, fetch, url } = setup([
      { match: '/v3.0/albums/tracks/', json: jamendoOk([rawJamendoAlbum()]) },
    ]);
    expect(await adapter.getCollection!('playlist:9')).toBeNull();
    expect(fetch.requests).toHaveLength(0);
    const album = await adapter.getCollection!('album:404149');
    expect(url().searchParams.get('id')).toBe('404149');
    expect(album?.tracks).toHaveLength(1);
  });

  test('search for artists and albums', async () => {
    const { adapter, url } = setup([
      { match: '/v3.0/artists/', json: jamendoOk([rawJamendoArtist()]) },
      { match: '/v3.0/albums/', json: jamendoOk([rawJamendoAlbum({ tracks: undefined })]) },
    ]);
    expect(await adapter.searchArtists!('ket', { limit: 2 })).toHaveLength(1);
    expect(url(0).searchParams.get('namesearch')).toBe('ket');
    const [album] = await adapter.searchCollections!('good', { limit: 2 });
    expect(album?.tracks).toBeUndefined();
  });

  test('resolveStream returns the audio url or NOT_FOUND', async () => {
    const { adapter } = setup([
      { match: 'id=gone', json: jamendoOk([]) },
      { match: '/v3.0/tracks/', json: jamendoOk([rawJamendoTrack()]) },
    ]);
    await expect(adapter.resolveStream('1886257')).resolves.toEqual({
      url: 'https://prod-1.storage.jamendo.com/?trackid=1886257&format=mp32',
      mirrors: [],
      live: false,
    });
    await expect(adapter.resolveStream('gone')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('jamendo adapter with malformed upstream items', () => {
  test('skips tracks that cannot be mapped instead of failing the source', async () => {
    const { adapter } = setup([
      {
        match: '/v3.0/tracks/',
        json: jamendoOk([{ ...rawJamendoTrack({ id: 'bad' }), name: null }, rawJamendoTrack()]),
      },
    ]);
    const tracks = await adapter.searchTracks('x', { limit: 5 });
    expect(tracks.map((t) => t.id)).toEqual(['jamendo:1886257']);
  });
});
