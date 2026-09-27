import { type Catalog, CatalogError, type SourceStatuses } from '@riff/catalog';
import type { Artist, Collection, Lyrics, Track } from '@riff/core';
import { vi } from 'vitest';

export const okSources: SourceStatuses = { audius: 'ok', jamendo: 'disabled', radio: 'ok' };

/**
 * In-memory Catalog for route tests. Every method is a vi.fn (override per test with
 * mockResolvedValueOnce / mockRejectedValueOnce). Stored values are deep-frozen, like the real
 * catalog's shared cache entries, so any mutation by the API throws.
 */
export function createFakeCatalog() {
  const tracks = new Map<string, Track>();
  const artists = new Map<string, Artist>();
  const artistTracks = new Map<string, Track[]>();
  const collections = new Map<string, Collection>();
  const lyrics = new Map<string, Lyrics>();
  const missing = (id: string) => new CatalogError('NOT_FOUND', `Nothing found for ${id}`);
  const lookup = <T>(map: Map<string, T>, id: string): T => {
    const value = map.get(id);
    if (value === undefined) throw missing(id);
    return value;
  };

  return {
    addTracks(...list: Track[]) {
      for (const track of list) tracks.set(track.id, deepFreeze(track));
    },
    addArtists(...list: Artist[]) {
      for (const artist of list) artists.set(artist.id, deepFreeze(artist));
    },
    setArtistTracks(artistId: string, list: Track[]) {
      artistTracks.set(artistId, deepFreeze(list));
    },
    addCollection(collection: Collection) {
      collections.set(collection.id, deepFreeze(collection));
    },
    setLyrics(trackId: string, value: Lyrics) {
      lyrics.set(trackId, deepFreeze(value));
    },

    search: vi.fn<Catalog['search']>(async () =>
      deepFreeze({ tracks: [], artists: [], collections: [], stations: [], sources: okSources }),
    ),
    trending: vi.fn<Catalog['trending']>(async () =>
      deepFreeze({ tracks: [], sources: okSources }),
    ),
    getTrack: vi.fn<Catalog['getTrack']>(async (id) => lookup(tracks, id)),
    getArtist: vi.fn<Catalog['getArtist']>(async (id) => lookup(artists, id)),
    getArtistTracks: vi.fn<Catalog['getArtistTracks']>(async (id, { limit }) =>
      (artistTracks.get(id) ?? []).slice(0, limit),
    ),
    getRelatedArtists: vi.fn<Catalog['getRelatedArtists']>(async () => []),
    getCollection: vi.fn<Catalog['getCollection']>(async (id) => lookup(collections, id)),
    resolveStream: vi.fn<Catalog['resolveStream']>(async (id) => {
      lookup(tracks, id);
      return { url: `https://cdn.example/${id}.mp3`, mirrors: [], live: false };
    }),
    getLyrics: vi.fn<Catalog['getLyrics']>(async (id) => {
      lookup(tracks, id);
      return lyrics.get(id) ?? null;
    }),
    radioTop: vi.fn<Catalog['radioTop']>(async () => []),
    radioSearch: vi.fn<Catalog['radioSearch']>(async () => []),
  } satisfies Catalog & Record<string, unknown>;
}

export type FakeCatalog = ReturnType<typeof createFakeCatalog>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
