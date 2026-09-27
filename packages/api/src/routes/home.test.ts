import { CatalogError } from '@riff/catalog';
import { DEFAULT_HOME_GENRES } from '@riff/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { okSources } from '../testing/fake-catalog';
import { makeArtist, makeTrack } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.trending.mockImplementation(async ({ genre }) => ({
    tracks: [makeTrack(`trend-${genre ?? 'all'}`)],
    sources: okSources,
  }));
});

const ids = (list: { id: string }[]) => list.map((track) => track.id);
const home = async (user: TestUser) => {
  const res = await user.get('/home');
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return res.json();
};

describe('GET /home', () => {
  test('a new user gets the default genres and global trending', async () => {
    const body = await home(alice);
    expect(body.recentlyPlayed).toEqual([]);
    expect(body.fromFollowed).toEqual([]);
    expect(body.topGenres.map((shelf: { genre: string }) => shelf.genre)).toEqual([
      ...DEFAULT_HOME_GENRES,
    ]);
    expect(ids(body.topGenres[0].tracks)).toEqual(['audius:ttrend-Electronic']);
    expect(ids(body.trending)).toEqual(['audius:ttrend-all']);
    expect(api.catalog.trending).toHaveBeenCalledWith({ genre: 'Electronic', limit: 12 });
    expect(api.catalog.trending).toHaveBeenCalledWith({ limit: 20 });
  });

  test('ranks genres by plays plus likes, then tops up with defaults', async () => {
    api.catalog.addTracks(
      makeTrack('h1', { genre: 'House' }),
      makeTrack('h2', { genre: 'House' }),
      makeTrack('t1', { genre: 'Techno' }),
      makeTrack('n1'),
    );
    await alice.post('/me/history', { trackId: 'audius:th1', msPlayed: 30_000 });
    await alice.post('/me/history', { trackId: 'audius:th1', msPlayed: 30_000 });
    await alice.put('/me/likes/audius:th2');
    await alice.put('/me/likes/audius:tt1');
    await alice.post('/me/history', { trackId: 'audius:tn1', msPlayed: 30_000 });

    const body = await home(alice);
    expect(body.topGenres.map((shelf: { genre: string }) => shelf.genre)).toEqual([
      'House',
      'Techno',
      'Electronic',
    ]);
    expect(ids(body.recentlyPlayed)).toEqual(expect.arrayContaining(['audius:th1', 'audius:tn1']));
    expect(body.recentlyPlayed).toHaveLength(2);
  });

  test('a genre with no trending tracks is left out', async () => {
    api.catalog.trending.mockImplementation(async ({ genre }) => ({
      tracks: genre === 'Lo-Fi' ? [] : [makeTrack(`trend-${genre ?? 'all'}`)],
      sources: okSources,
    }));
    const body = await home(alice);
    expect(body.topGenres.map((shelf: { genre: string }) => shelf.genre)).toEqual([
      'Electronic',
      'Hip-Hop/Rap',
    ]);
  });

  test('fromFollowed asks for each followed artist’s newest tracks, not their most played', async () => {
    api.catalog.addArtists(makeArtist(1));
    await alice.put('/me/following/audius:a1');
    await home(alice);
    expect(api.catalog.getArtistTracks).toHaveBeenCalledWith('audius:a1', {
      limit: 5,
      sort: 'newest',
    });
  });

  test('fromFollowed merges followed artists’ tracks newest first, without duplicates', async () => {
    api.catalog.addArtists(makeArtist(1), makeArtist(2), makeArtist(3));
    api.catalog.setArtistTracks('audius:a1', [
      makeTrack('old', { releaseDate: '2020-01-01' }),
      makeTrack('shared', { releaseDate: '2024-06-01' }),
    ]);
    api.catalog.setArtistTracks('audius:a2', [
      makeTrack('new', { releaseDate: '2025-03-01' }),
      makeTrack('shared', { releaseDate: '2024-06-01' }),
      makeTrack('undated'),
    ]);
    await alice.put('/me/following/audius:a1');
    await alice.put('/me/following/audius:a2');
    await alice.put('/me/following/audius:a3');
    api.catalog.getArtistTracks.mockImplementationOnce(async () => {
      throw new CatalogError('UPSTREAM_ERROR', 'down');
    });

    const body = await home(alice);
    expect(ids(body.fromFollowed)).toEqual([
      'audius:tnew',
      'audius:tshared',
      'audius:told',
      'audius:tundated',
    ]);
    expect(api.errors).toHaveLength(1);
  });

  test('a failing section comes back empty and the rest still render', async () => {
    api.catalog.addTracks(makeTrack(1));
    await alice.post('/me/history', { trackId: 'audius:t1', msPlayed: 30_000 });
    api.catalog.trending.mockRejectedValue(new CatalogError('UPSTREAM_TIMEOUT', 'slow'));

    const body = await home(alice);
    expect(body.trending).toEqual([]);
    expect(body.topGenres).toEqual([]);
    expect(ids(body.recentlyPlayed)).toEqual(['audius:t1']);
    expect(api.errors.length).toBeGreaterThan(0);
  });
});
