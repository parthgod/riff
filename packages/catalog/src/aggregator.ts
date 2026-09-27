import {
  type Artist,
  type Collection,
  type Lyrics,
  parseEntityId,
  SOURCE_IDS,
  type SourceId,
  type StreamInfo,
  type Track,
  type TrendingWindow,
} from '@riff/core';
import type { RadioAdapter, SourceAdapter } from './adapter';
import type { Cache } from './cache';
import { CatalogError, isCatalogError } from './errors';
import type { LyricsClient } from './lyrics/lrclib';
import { dedupeAcrossSources, interleave } from './merge';

export type SourceStatus = 'ok' | 'error' | 'timeout' | 'disabled';
export type SourceStatuses = Record<SourceId, SourceStatus>;

export interface SearchResult {
  tracks: Track[];
  artists: Artist[];
  collections: Collection[];
  /** Live radio stations; never mixed into `tracks`. */
  stations: Track[];
  sources: SourceStatuses;
}

export interface TrendingResult {
  tracks: Track[];
  sources: SourceStatuses;
}

export interface Catalog {
  search(query: string, options: { limit: number }): Promise<SearchResult>;
  trending(options: {
    genre?: string;
    window?: TrendingWindow;
    limit: number;
  }): Promise<TrendingResult>;
  /** Single-entity reads reject with CatalogError NOT_FOUND for unknown or invalid ids. */
  getTrack(id: string): Promise<Track>;
  getArtist(id: string): Promise<Artist>;
  getArtistTracks(id: string, options: { limit: number }): Promise<Track[]>;
  getRelatedArtists(id: string, options: { limit: number }): Promise<Artist[]>;
  getCollection(id: string): Promise<Collection>;
  resolveStream(id: string): Promise<StreamInfo>;
  /** null for live tracks and when no lyrics exist. */
  getLyrics(id: string): Promise<Lyrics | null>;
  radioTop(options: { tag?: string; limit: number }): Promise<Track[]>;
  radioSearch(query: string, options: { limit: number }): Promise<Track[]>;
}

export interface AggregatorDeps {
  music: readonly SourceAdapter[];
  radio: RadioAdapter | null;
  lyrics: LyricsClient;
  cache: Cache;
  /** Per-source budget for fan-out calls (search, trending). Default 3000 ms. */
  searchTimeoutMs?: number;
  /** Budget for single-entity calls. Default 8000 ms. */
  entityTimeoutMs?: number;
  /** Called when a source fails during fan-out; the request itself still succeeds. */
  onSourceError?: (source: SourceId, error: unknown) => void;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const CACHE_TTL = {
  search: 5 * MINUTE,
  trending: 10 * MINUTE,
  entity: HOUR,
  lyricsFound: 24 * HOUR,
  lyricsMissing: 6 * HOUR,
  /** Results where some source failed are retried soon. */
  partial: 30_000,
} as const;

type Loader<T> = (
  adapter: SourceAdapter,
  nativeId: string,
  signal: AbortSignal,
) => Promise<T> | undefined;

export function createAggregator(deps: AggregatorDeps): Catalog {
  const searchTimeoutMs = deps.searchTimeoutMs ?? 3000;
  const entityTimeoutMs = deps.entityTimeoutMs ?? 8000;
  const adapters = new Map<SourceId, SourceAdapter>();
  for (const adapter of deps.music) adapters.set(adapter.id, adapter);
  if (deps.radio) adapters.set(deps.radio.id, deps.radio);

  const fanoutSignal = () => AbortSignal.timeout(searchTimeoutMs);
  const entitySignal = () => AbortSignal.timeout(entityTimeoutMs);

  function settle<T>(source: SourceId, result: PromiseSettledResult<T>, fallback: T) {
    if (result.status === 'fulfilled') return { status: 'ok' as SourceStatus, value: result.value };
    deps.onSourceError?.(source, result.reason);
    const status: SourceStatus = isCatalogError(result.reason, 'UPSTREAM_TIMEOUT')
      ? 'timeout'
      : 'error';
    return { status, value: fallback };
  }

  function resolve(id: string): { adapter: SourceAdapter; nativeId: string } {
    const parsed = parseEntityId(id);
    const adapter = parsed ? adapters.get(parsed.source) : undefined;
    if (!parsed || !adapter) throw notFound(id);
    return { adapter, nativeId: parsed.nativeId };
  }

  function cachedEntity<T>(key: string, id: string, load: Loader<T | null>): Promise<T> {
    return deps.cache.getOrSet(key, CACHE_TTL.entity, async () => {
      const { adapter, nativeId } = resolve(id);
      const value = await load(adapter, nativeId, entitySignal());
      if (value == null) throw notFound(id);
      return value;
    });
  }

  function cachedList<T>(key: string, id: string, load: Loader<T[]>): Promise<T[]> {
    return deps.cache.getOrSet(key, CACHE_TTL.entity, async () => {
      const { adapter, nativeId } = resolve(id);
      return (await load(adapter, nativeId, entitySignal())) ?? [];
    });
  }

  const getTrack = (id: string) =>
    cachedEntity<Track>(`track:${id}`, id, (adapter, nativeId, signal) =>
      adapter.getTrack(nativeId, { signal }),
    );

  return {
    async search(query, { limit }) {
      const q = query.trim();
      if (!q)
        return { tracks: [], artists: [], collections: [], stations: [], sources: allDisabled() };

      return deps.cache.getOrSet<SearchResult>(
        `search:${limit}:${q.toLowerCase()}`,
        ttlUnlessPartial(CACHE_TTL.search),
        async () => {
          const sources = allDisabled();
          const music = Promise.all(
            deps.music.map(async (adapter) => {
              const options = { limit, signal: fanoutSignal() };
              const [tracks, artists, collections] = await Promise.allSettled([
                adapter.searchTracks(q, options),
                adapter.searchArtists?.(q, options) ?? [],
                adapter.searchCollections?.(q, options) ?? [],
              ]);
              const settledTracks = settle(adapter.id, tracks, []);
              sources[adapter.id] = settledTracks.status;
              return {
                tracks: settledTracks.value,
                artists: artists.status === 'fulfilled' ? artists.value : [],
                collections: collections.status === 'fulfilled' ? collections.value : [],
              };
            }),
          );
          const radio = deps.radio;
          const stations = radio
            ? Promise.allSettled([radio.searchTracks(q, { limit, signal: fanoutSignal() })]).then(
                ([result]) => {
                  const settled = settle(radio.id, result, []);
                  sources[radio.id] = settled.status;
                  return settled.value;
                },
              )
            : Promise.resolve<Track[]>([]);

          const [perSource, stationTracks] = await Promise.all([music, stations]);
          return {
            tracks: dedupeAcrossSources(interleave(perSource.map((r) => r.tracks))).slice(0, limit),
            artists: interleave(perSource.map((r) => r.artists)).slice(0, limit),
            collections: interleave(perSource.map((r) => r.collections)).slice(0, limit),
            stations: stationTracks,
            sources,
          };
        },
      );
    },

    async trending({ genre, window = 'week', limit }) {
      return deps.cache.getOrSet<TrendingResult>(
        `trending:${genre ?? '*'}:${window}:${limit}`,
        ttlUnlessPartial(CACHE_TTL.trending),
        async () => {
          const sources = allDisabled();
          const lists = await Promise.all(
            deps.music.map(async (adapter) => {
              if (!adapter.trending) return [];
              const [result] = await Promise.allSettled([
                adapter.trending({ genre, window, limit, signal: fanoutSignal() }),
              ]);
              const settled = settle(adapter.id, result, []);
              sources[adapter.id] = settled.status;
              return settled.value;
            }),
          );
          return { tracks: dedupeAcrossSources(interleave(lists)).slice(0, limit), sources };
        },
      );
    },

    getTrack,

    getArtist: (id) =>
      cachedEntity<Artist>(`artist:${id}`, id, (adapter, nativeId, signal) =>
        adapter.getArtist?.(nativeId, { signal }),
      ),

    getArtistTracks: (id, { limit }) =>
      cachedList<Track>(`artist-tracks:${id}:${limit}`, id, (adapter, nativeId, signal) =>
        adapter.getArtistTracks?.(nativeId, { limit, signal }),
      ),

    getRelatedArtists: (id, { limit }) =>
      cachedList<Artist>(`related:${id}:${limit}`, id, (adapter, nativeId, signal) =>
        adapter.getRelatedArtists?.(nativeId, { limit, signal }),
      ),

    getCollection: (id) =>
      cachedEntity<Collection>(`collection:${id}`, id, (adapter, nativeId, signal) =>
        adapter.getCollection?.(nativeId, { signal }),
      ),

    async resolveStream(id) {
      const { adapter, nativeId } = resolve(id);
      return adapter.resolveStream(nativeId, { signal: entitySignal() });
    },

    async getLyrics(id) {
      const track = await getTrack(id);
      if (track.isLive) return null;
      return deps.cache.getOrSet<Lyrics | null>(
        `lyrics:${id}`,
        (lyrics) => (lyrics ? CACHE_TTL.lyricsFound : CACHE_TTL.lyricsMissing),
        () =>
          deps.lyrics.getLyrics(
            {
              title: track.title,
              artist: track.artists[0]?.name ?? '',
              album: track.album?.title,
              durationSec: track.durationSec,
            },
            { signal: entitySignal() },
          ),
      );
    },

    async radioTop({ tag, limit }) {
      const radio = deps.radio;
      if (!radio) return [];
      return deps.cache.getOrSet(`radio-top:${tag ?? '*'}:${limit}`, CACHE_TTL.trending, () =>
        radio.top({ tag, limit, signal: entitySignal() }),
      );
    },

    async radioSearch(query, { limit }) {
      const radio = deps.radio;
      const q = query.trim();
      if (!radio || !q) return [];
      return deps.cache.getOrSet(`radio-search:${limit}:${q.toLowerCase()}`, CACHE_TTL.search, () =>
        radio.searchTracks(q, { limit, signal: entitySignal() }),
      );
    },
  };
}

function allDisabled(): SourceStatuses {
  return Object.fromEntries(SOURCE_IDS.map((id) => [id, 'disabled'])) as SourceStatuses;
}

function ttlUnlessPartial(ttl: number) {
  return (result: { sources: SourceStatuses }): number =>
    Object.values(result.sources).some((s) => s === 'error' || s === 'timeout')
      ? CACHE_TTL.partial
      : ttl;
}

function notFound(id: string): CatalogError {
  return new CatalogError('NOT_FOUND', `Nothing found for ${id}`);
}
