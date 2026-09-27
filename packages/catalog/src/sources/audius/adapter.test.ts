import { describe, expect, test } from 'vitest';
import { createHttpClient } from '../../http';
import { type FakeRoute, fakeFetch } from '../../testing/fake-fetch';
import { createAudiusAdapter } from './adapter';
import { rawPlaylist, rawTrack, rawUser } from './fixtures';

const config = { apiUrl: 'https://api.audius.test', appName: 'riff-test' };

function setup(routes: FakeRoute[]) {
  const fetch = fakeFetch(routes);
  const adapter = createAudiusAdapter({
    http: createHttpClient({ fetch, userAgent: 'ua' }),
    config,
  });
  return { adapter, fetch, url: (i = 0) => new URL(fetch.requests[i]!.url) };
}

describe('audius adapter', () => {
  test('searchTracks encodes the query, sends app_name and drops unplayable tracks', async () => {
    const { adapter, url } = setup([
      {
        match: '/v1/tracks/search',
        json: { data: [rawTrack(), rawTrack({ id: 'gated', is_stream_gated: true })] },
      },
    ]);
    const tracks = await adapter.searchTracks('AC/DC & Beyoncé', { limit: 5 });
    expect(tracks.map((t) => t.id)).toEqual(['audius:NQwXON0']);
    expect(url().pathname).toBe('/v1/tracks/search');
    expect(url().searchParams.get('query')).toBe('AC/DC & Beyoncé');
    expect(url().searchParams.get('limit')).toBe('5');
    expect(url().searchParams.get('app_name')).toBe('riff-test');
  });

  test('trending passes genre and time window, omitting genre when absent', async () => {
    const { adapter, url } = setup([
      { match: '/v1/tracks/trending', json: { data: [rawTrack()] } },
    ]);
    await adapter.trending!({ genre: 'Lo-Fi', window: 'month', limit: 10 });
    expect(url(0).searchParams.get('genre')).toBe('Lo-Fi');
    expect(url(0).searchParams.get('time')).toBe('month');
    await adapter.trending!({ limit: 10 });
    expect(url(1).searchParams.has('genre')).toBe(false);
    expect(url(1).searchParams.get('time')).toBe('week');
  });

  test('getTrack maps a track and returns null for invalid ids or unplayable tracks', async () => {
    const { adapter } = setup([
      { match: '/v1/tracks/NQwXON0', json: { data: rawTrack() } },
      { match: '/v1/tracks/zzz', status: 400, json: { code: 400, error: 'invalid trackId' } },
      { match: '/v1/tracks/gone', json: { data: rawTrack({ id: 'gone', is_delete: true }) } },
    ]);
    expect((await adapter.getTrack('NQwXON0'))?.title).toBe('Rave! Code Radio 025');
    expect(await adapter.getTrack('zzz')).toBeNull();
    expect(await adapter.getTrack('gone')).toBeNull();
  });

  test('artist endpoints map users, top tracks by plays and related artists', async () => {
    const { adapter, fetch } = setup([
      { match: '/v1/users/k259kWP/tracks', json: { data: [rawTrack()] } },
      {
        match: '/v1/users/k259kWP/related',
        json: { data: [rawUser({ id: 'rel1', name: 'Rel' })] },
      },
      { match: '/v1/users/k259kWP', json: { data: rawUser() } },
      { match: '/v1/users/nope', status: 400, json: {} },
    ]);
    expect((await adapter.getArtist!('k259kWP'))?.name).toBe('Van Snyder');
    expect(await adapter.getArtist!('nope')).toBeNull();
    const top = await adapter.getArtistTracks!('k259kWP', { limit: 10 });
    expect(top.map((t) => t.id)).toEqual(['audius:NQwXON0']);
    expect(new URL(fetch.requests[2]!.url).searchParams.get('sort')).toBe('plays');
    const related = await adapter.getRelatedArtists!('k259kWP', { limit: 5 });
    expect(related[0]?.id).toBe('audius:rel1');
  });

  test('getCollection unwraps the single-item array', async () => {
    const { adapter } = setup([
      { match: '/v1/playlists/xPjKvK9', json: { data: [rawPlaylist()] } },
      { match: '/v1/playlists/none', json: { data: [] } },
    ]);
    const collection = await adapter.getCollection!('xPjKvK9');
    expect(collection?.tracks?.map((t) => t.id)).toEqual(['audius:NQwXON0', 'audius:Abc123']);
    expect(await adapter.getCollection!('none')).toBeNull();
  });

  test('artist and collection search omit collection tracks', async () => {
    const { adapter } = setup([
      { match: '/v1/users/search', json: { data: [rawUser()] } },
      { match: '/v1/playlists/search', json: { data: [rawPlaylist({ is_album: true })] } },
    ]);
    expect((await adapter.searchArtists!('van', { limit: 3 }))[0]?.verified).toBe(true);
    const [album] = await adapter.searchCollections!('walk', { limit: 3 });
    expect(album?.kind).toBe('album');
    expect(album?.tracks).toBeUndefined();
  });

  test('resolveStream returns the signed url plus distinct mirrors on other hosts', async () => {
    const signed = 'https://node-a.test/tracks/cidstream/cid?signature=%7B%22a%22%3A1%7D';
    const { adapter } = setup([
      {
        match: '/v1/tracks/NQwXON0',
        json: {
          data: rawTrack({
            stream: {
              url: signed,
              mirrors: [
                'https://node-a.test',
                'https://node-b.test',
                'https://node-b.test',
                'nope',
              ],
            },
          }),
        },
      },
    ]);
    await expect(adapter.resolveStream('NQwXON0')).resolves.toEqual({
      url: signed,
      mirrors: ['https://node-b.test/tracks/cidstream/cid?signature=%7B%22a%22%3A1%7D'],
      live: false,
    });
  });

  test('resolveStream falls back to the stream endpoint and rejects unplayable tracks', async () => {
    const { adapter, url } = setup([
      {
        match: '/v1/tracks/old/stream',
        json: { data: 'https://node-a.test/tracks/cidstream/old' },
      },
      { match: '/v1/tracks/old', json: { data: rawTrack({ id: 'old', stream: null }) } },
      {
        match: '/v1/tracks/gated',
        json: { data: rawTrack({ id: 'gated', is_stream_gated: true }) },
      },
    ]);
    await expect(adapter.resolveStream('old')).resolves.toEqual({
      url: 'https://node-a.test/tracks/cidstream/old',
      mirrors: [],
      live: false,
    });
    expect(url(1).searchParams.get('no_redirect')).toBe('true');
    await expect(adapter.resolveStream('gated')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
