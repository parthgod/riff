import { TrackSchema } from '@riff/core';
import { describe, expect, test } from 'vitest';
import { catalogConfigFromEnv, createCatalog, DEFAULT_USER_AGENT } from './create-catalog';
import { createHttpClient } from './http';
import { createLrclibClient } from './lyrics/lrclib';

// Hits the real upstreams. Run with: pnpm --filter @riff/catalog test:live
describe.skipIf(!process.env.LIVE)('live upstreams', { timeout: 60_000 }, () => {
  const catalog = createCatalog(catalogConfigFromEnv(process.env));

  test('Audius trending tracks are schema-valid and their streams serve audio', async () => {
    const { tracks, sources } = await catalog.trending({ limit: 5 });
    expect(sources.audius).toBe('ok');
    expect(tracks.length).toBeGreaterThan(0);
    for (const track of tracks) TrackSchema.parse(track);

    const stream = await catalog.resolveStream(tracks[0]!.id);
    const response = await fetch(stream.url, { headers: { range: 'bytes=0-1023' } });
    expect([200, 206]).toContain(response.status);
    expect(response.headers.get('content-type')).toMatch(/^audio\//);
    await response.body?.cancel();
  });

  test('artist pages and collections resolve', async () => {
    const { tracks } = await catalog.trending({ limit: 1 });
    const artistId = tracks[0]!.artists[0]!.id;
    expect((await catalog.getArtist(artistId)).name.length).toBeGreaterThan(0);
    expect((await catalog.getArtistTracks(artistId, { limit: 5 })).length).toBeGreaterThan(0);
    expect(Array.isArray(await catalog.getRelatedArtists(artistId, { limit: 5 }))).toBe(true);

    const { collections } = await catalog.search('chill', { limit: 5 });
    expect(collections.length).toBeGreaterThan(0);
    const collection = await catalog.getCollection(collections[0]!.id);
    expect(Array.isArray(collection.tracks)).toBe(true);
  });

  test('Jamendo answers when a client id is configured', async () => {
    if (!process.env.JAMENDO_CLIENT_ID) return;
    const { sources, tracks } = await catalog.search('piano', { limit: 10 });
    expect(sources.jamendo).toBe('ok');
    expect(tracks.some((t) => t.source === 'jamendo')).toBe(true);
  });

  test('radio returns playable https stations', async () => {
    const stations = await catalog.radioTop({ limit: 5 });
    expect(stations.length).toBeGreaterThan(0);
    for (const station of stations) expect(station.isLive).toBe(true);
    const stream = await catalog.resolveStream(stations[0]!.id);
    expect(stream.url).toMatch(/^https:\/\//);
  });

  test('LRCLIB returns synced lyrics for a well-known song', async () => {
    const lyrics = createLrclibClient({
      http: createHttpClient({ userAgent: DEFAULT_USER_AGENT }),
    });
    const result = await lyrics.getLyrics({ title: 'One More Time', artist: 'Daft Punk' });
    expect(result?.synced?.length ?? 0).toBeGreaterThan(0);
  });
});
