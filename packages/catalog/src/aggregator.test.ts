import type { SourceId, Track } from '@riff/core';
import { describe, expect, test, vi } from 'vitest';
import type { ListOptions, RadioAdapter, SourceAdapter } from './adapter';
import { createAggregator } from './aggregator';
import { createMemoryCache } from './cache';
import { CatalogError } from './errors';
import type { LyricsClient } from './lyrics/lrclib';

const t = (source: SourceId, n: number, artist = `Artist ${n}`, title = `Song ${n}`): Track => ({
  id: `${source}:${n}`,
  source,
  title,
  artists: [{ id: `${source}:a${n}`, name: artist }],
  durationSec: 100,
  isLive: false,
  artwork: {},
});

const live: Track = {
  id: 'radio:s1',
  source: 'radio',
  title: 'Station',
  artists: [],
  durationSec: null,
  isLive: true,
  artwork: {},
};

function fakeAdapter(id: SourceId, overrides: Partial<SourceAdapter> = {}): SourceAdapter {
  return {
    id,
    searchTracks: vi.fn(async () => []),
    getTrack: vi.fn(async () => null),
    resolveStream: vi.fn(async () => ({
      url: `https://${id}.test/stream`,
      mirrors: [],
      live: false,
    })),
    ...overrides,
  };
}

function fakeRadio(overrides: Partial<RadioAdapter> = {}): RadioAdapter {
  return { ...fakeAdapter('radio'), top: vi.fn(async () => [live]), ...overrides };
}

/** Never settles until aborted, then rejects the way the http client does on timeout. */
const hang = (_query: string, options: ListOptions) =>
  new Promise<Track[]>((_, reject) => {
    options.signal?.addEventListener(
      'abort',
      () => reject(new CatalogError('UPSTREAM_TIMEOUT', 'slow')),
      { once: true },
    );
  });

const failing = async (): Promise<Track[]> => {
  throw new CatalogError('UPSTREAM_ERROR', 'down');
};

function setup(
  parts: {
    music?: SourceAdapter[];
    radio?: RadioAdapter | null;
    lyrics?: LyricsClient;
    now?: () => number;
    onSourceError?: (source: SourceId, error: unknown) => void;
  } = {},
) {
  return createAggregator({
    music: parts.music ?? [],
    radio: parts.radio ?? null,
    lyrics: parts.lyrics ?? { getLyrics: vi.fn(async () => null) },
    cache: createMemoryCache({ now: parts.now }),
    searchTimeoutMs: 30,
    onSourceError: parts.onSourceError,
  });
}

describe('search', () => {
  test('interleaves tracks across sources and reports each source', async () => {
    const audius = fakeAdapter('audius', {
      searchTracks: vi.fn(async () => [t('audius', 1), t('audius', 2)]),
    });
    const jamendo = fakeAdapter('jamendo', { searchTracks: vi.fn(async () => [t('jamendo', 3)]) });
    const result = await setup({ music: [audius, jamendo] }).search('x', { limit: 10 });
    expect(result.tracks.map((x) => x.id)).toEqual(['audius:1', 'jamendo:3', 'audius:2']);
    expect(result.sources).toEqual({ audius: 'ok', jamendo: 'ok', radio: 'disabled' });
  });

  test('returns partial results when sources fail or time out', async () => {
    const onSourceError = vi.fn();
    const audius = fakeAdapter('audius', { searchTracks: vi.fn(async () => [t('audius', 1)]) });
    const jamendo = fakeAdapter('jamendo', { searchTracks: vi.fn(hang) });
    const radio = fakeRadio({ searchTracks: vi.fn(failing) });
    const result = await setup({ music: [audius, jamendo], radio, onSourceError }).search('x', {
      limit: 10,
    });
    expect(result.tracks.map((x) => x.id)).toEqual(['audius:1']);
    expect(result.sources).toEqual({ audius: 'ok', jamendo: 'timeout', radio: 'error' });
    expect(onSourceError).toHaveBeenCalledWith('jamendo', expect.any(CatalogError));
    expect(onSourceError).toHaveBeenCalledWith('radio', expect.any(CatalogError));
  });

  test('dedupes across sources only', async () => {
    const audius = fakeAdapter('audius', {
      searchTracks: vi.fn(async () => [
        t('audius', 1, 'Ketsa', 'Sunny Side'),
        t('audius', 2, 'Ketsa', 'Sunny Side'),
      ]),
    });
    const jamendo = fakeAdapter('jamendo', {
      searchTracks: vi.fn(async () => [t('jamendo', 3, 'KETSA', 'Sunny Side (feat. Someone)')]),
    });
    const result = await setup({ music: [audius, jamendo] }).search('sunny', { limit: 10 });
    expect(result.tracks.map((x) => x.id)).toEqual(['audius:1', 'audius:2']);
  });

  test('puts radio results in stations, and artists/collections alongside tracks', async () => {
    const audius = fakeAdapter('audius', {
      searchTracks: vi.fn(async () => [t('audius', 1)]),
      searchArtists: vi.fn(async () => [
        { id: 'audius:a1', source: 'audius', name: 'A', avatar: {}, verified: false } as const,
      ]),
    });
    const radio = fakeRadio({ searchTracks: vi.fn(async () => [live]) });
    const result = await setup({ music: [audius], radio }).search('x', { limit: 5 });
    expect(result.stations.map((s) => s.id)).toEqual(['radio:s1']);
    expect(result.tracks.map((s) => s.id)).toEqual(['audius:1']);
    expect(result.artists.map((a) => a.id)).toEqual(['audius:a1']);
    expect(result.collections).toEqual([]);
    expect(result.sources.radio).toBe('ok');
  });

  test('blank queries return empty results without calling sources', async () => {
    const audius = fakeAdapter('audius');
    const result = await setup({ music: [audius] }).search('   ', { limit: 5 });
    expect(result.tracks).toEqual([]);
    expect(audius.searchTracks).not.toHaveBeenCalled();
  });

  test('normalises the cache key and keeps complete results for 5 minutes', async () => {
    let now = 0;
    const audius = fakeAdapter('audius', { searchTracks: vi.fn(async () => [t('audius', 1)]) });
    const catalog = setup({ music: [audius], now: () => now });
    await catalog.search('Lofi', { limit: 5 });
    await catalog.search('  lofi ', { limit: 5 });
    now += 4 * 60_000;
    await catalog.search('LOFI', { limit: 5 });
    expect(audius.searchTracks).toHaveBeenCalledTimes(1);
  });

  test('caches partial results for only 30 seconds', async () => {
    let now = 0;
    const audius = fakeAdapter('audius', { searchTracks: vi.fn(async () => [t('audius', 1)]) });
    const jamendo = fakeAdapter('jamendo', { searchTracks: vi.fn(failing) });
    const catalog = setup({ music: [audius, jamendo], now: () => now });
    await catalog.search('q', { limit: 5 });
    await catalog.search('q', { limit: 5 });
    expect(audius.searchTracks).toHaveBeenCalledTimes(1);
    now += 31_000;
    await catalog.search('q', { limit: 5 });
    expect(audius.searchTracks).toHaveBeenCalledTimes(2);
  });
});

describe('trending', () => {
  test('passes genre and window, and leaves sources without trending disabled', async () => {
    const audius = fakeAdapter('audius', { trending: vi.fn(async () => [t('audius', 1)]) });
    const jamendo = fakeAdapter('jamendo');
    const result = await setup({ music: [audius, jamendo] }).trending({
      genre: 'Lo-Fi',
      window: 'month',
      limit: 5,
    });
    expect(audius.trending).toHaveBeenCalledWith(
      expect.objectContaining({ genre: 'Lo-Fi', window: 'month', limit: 5 }),
    );
    expect(result.tracks.map((x) => x.id)).toEqual(['audius:1']);
    expect(result.sources).toMatchObject({ audius: 'ok', jamendo: 'disabled' });
  });
});

describe('single entities', () => {
  test('getTrack routes by id prefix, caches, and rejects unknown ids with NOT_FOUND', async () => {
    const audius = fakeAdapter('audius', {
      getTrack: vi.fn(async (id: string) => (id === '1' ? t('audius', 1) : null)),
    });
    const catalog = setup({ music: [audius] });
    await expect(catalog.getTrack('audius:1')).resolves.toMatchObject({ id: 'audius:1' });
    await catalog.getTrack('audius:1');
    expect(audius.getTrack).toHaveBeenCalledTimes(1);
    await expect(catalog.getTrack('audius:2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(catalog.getTrack('jamendo:1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(catalog.getTrack('garbage')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('missing capabilities mean NOT_FOUND for entities and [] for lists', async () => {
    const catalog = setup({ radio: fakeRadio() });
    await expect(catalog.getArtist('radio:x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(catalog.getCollection('radio:x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(catalog.getArtistTracks('radio:x', { limit: 5 })).resolves.toEqual([]);
    await expect(catalog.getRelatedArtists('radio:x', { limit: 5 })).resolves.toEqual([]);
  });

  test('getArtistTracks passes the sort through and caches each sort separately', async () => {
    const audius = fakeAdapter('audius', {
      getArtistTracks: vi.fn(async () => [t('audius', 1)]),
    });
    const catalog = setup({ music: [audius] });
    await catalog.getArtistTracks('audius:a1', { limit: 5 });
    await catalog.getArtistTracks('audius:a1', { limit: 5, sort: 'newest' });
    await catalog.getArtistTracks('audius:a1', { limit: 5, sort: 'newest' });
    expect(audius.getArtistTracks).toHaveBeenCalledTimes(2);
    expect(audius.getArtistTracks).toHaveBeenNthCalledWith(
      1,
      'a1',
      expect.objectContaining({ limit: 5, sort: 'popular' }),
    );
    expect(audius.getArtistTracks).toHaveBeenNthCalledWith(
      2,
      'a1',
      expect.objectContaining({ limit: 5, sort: 'newest' }),
    );
  });

  test('resolveStream is never cached', async () => {
    const audius = fakeAdapter('audius');
    const catalog = setup({ music: [audius] });
    await catalog.resolveStream('audius:1');
    await catalog.resolveStream('audius:1');
    expect(audius.resolveStream).toHaveBeenCalledTimes(2);
  });
});

describe('getLyrics', () => {
  test('skips live tracks, passes track metadata, and caches misses', async () => {
    const song: Track = {
      ...t('audius', 1, 'Daft Punk', 'One More Time'),
      durationSec: 320,
      album: { id: 'audius:al', title: 'Discovery' },
    };
    const audius = fakeAdapter('audius', { getTrack: vi.fn(async () => song) });
    const radio = fakeRadio({ getTrack: vi.fn(async () => live) });
    const lyrics: LyricsClient = { getLyrics: vi.fn(async () => null) };
    const catalog = setup({ music: [audius], radio, lyrics });

    expect(await catalog.getLyrics('radio:s1')).toBeNull();
    expect(lyrics.getLyrics).not.toHaveBeenCalled();

    expect(await catalog.getLyrics('audius:1')).toBeNull();
    await catalog.getLyrics('audius:1');
    expect(lyrics.getLyrics).toHaveBeenCalledTimes(1);
    expect(lyrics.getLyrics).toHaveBeenCalledWith(
      { title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', durationSec: 320 },
      expect.anything(),
    );
  });
});

describe('radio', () => {
  test('radioTop and radioSearch delegate to the radio adapter, or return [] without one', async () => {
    const radio = fakeRadio({ searchTracks: vi.fn(async () => [live]) });
    const catalog = setup({ radio });
    expect(await catalog.radioTop({ tag: 'jazz', limit: 3 })).toEqual([live]);
    expect(radio.top).toHaveBeenCalledWith(expect.objectContaining({ tag: 'jazz', limit: 3 }));
    expect(await catalog.radioSearch('lofi', { limit: 3 })).toEqual([live]);
    expect(await setup().radioTop({ limit: 3 })).toEqual([]);
    expect(await catalog.radioSearch('  ', { limit: 3 })).toEqual([]);
  });
});

describe('search sub-requests', () => {
  test('reports artist/collection search failures and caches the result as partial', async () => {
    let now = 0;
    const onSourceError = vi.fn();
    const audius = fakeAdapter('audius', {
      searchTracks: vi.fn(async () => [t('audius', 1)]),
      searchArtists: vi.fn(async () => {
        throw new CatalogError('UPSTREAM_ERROR', 'artists down');
      }),
    });
    const catalog = setup({ music: [audius], now: () => now, onSourceError });
    const result = await catalog.search('q', { limit: 5 });
    expect(result.tracks.map((x) => x.id)).toEqual(['audius:1']);
    expect(result.sources.audius).toBe('error');
    expect(onSourceError).toHaveBeenCalledWith('audius', expect.any(CatalogError));
    now += 31_000;
    await catalog.search('q', { limit: 5 });
    expect(audius.searchArtists).toHaveBeenCalledTimes(2);
  });
});
