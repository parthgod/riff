import { ArtistSchema, CollectionSchema, TrackSchema } from '@riff/core';
import type { SourceAdapter } from '../../adapter';
import { CatalogError } from '../../errors';
import type { HttpClient } from '../../http';
import { mapOneValid, mapValid } from '../../map-valid';
import { isPlayable, mapPlaylist, mapTrack, mapTracks, mapUser } from './map';
import type { AudiusPlaylist, AudiusTrack, AudiusUser } from './types';

export interface AudiusConfig {
  apiUrl: string;
  appName: string;
}

type Params = Record<string, string | number | undefined>;

/** Rebuilds a signed stream URL on each mirror host, skipping the original host and bad entries. */
export function mirrorUrls(url: string, hosts: readonly string[]): string[] {
  const original = new URL(url);
  const result = new Set<string>();
  for (const host of hosts) {
    let mirror: URL;
    try {
      mirror = new URL(host);
    } catch {
      continue;
    }
    if (mirror.host === original.host) continue;
    const candidate = new URL(url);
    candidate.protocol = mirror.protocol;
    candidate.host = mirror.host;
    result.add(candidate.toString());
  }
  return [...result];
}

export function createAudiusAdapter({
  http,
  config,
}: {
  http: HttpClient;
  config: AudiusConfig;
}): SourceAdapter {
  const base = config.apiUrl.replace(/\/$/, '');
  const enc = encodeURIComponent;

  function endpoint(path: string, params: Params = {}): string {
    const url = new URL(`${base}/v1${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    url.searchParams.set('app_name', config.appName);
    return url.toString();
  }

  async function list<T>(path: string, params: Params, signal?: AbortSignal): Promise<T[]> {
    const body = await http.getJson<{ data: T[] | null }>(endpoint(path, params), {
      upstream: 'audius',
      signal,
    });
    return body?.data ?? [];
  }

  /** Single-entity read: Audius answers 400 for ids it cannot decode. */
  async function one<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    const body = await http.getJson<{ data: T | null }>(endpoint(path), {
      upstream: 'audius',
      signal,
      notFoundStatuses: [400, 404],
    });
    return body?.data ?? null;
  }

  async function playableTrack(id: string, signal?: AbortSignal): Promise<AudiusTrack | null> {
    const track = await one<AudiusTrack>(`/tracks/${enc(id)}`, signal);
    return track && isPlayable(track) ? track : null;
  }

  return {
    id: 'audius',

    async searchTracks(query, { limit, signal }) {
      return mapTracks(await list<AudiusTrack>('/tracks/search', { query, limit }, signal));
    },

    async searchArtists(query, { limit, signal }) {
      const users = await list<AudiusUser>('/users/search', { query, limit }, signal);
      return mapValid(users, mapUser, ArtistSchema);
    },

    async searchCollections(query, { limit, signal }) {
      const playlists = await list<AudiusPlaylist>('/playlists/search', { query, limit }, signal);
      return mapValid(
        playlists,
        (playlist) => mapPlaylist(playlist, { withTracks: false }),
        CollectionSchema,
      );
    },

    async trending({ genre, window = 'week', limit, signal }) {
      return mapTracks(
        await list<AudiusTrack>('/tracks/trending', { genre, time: window, limit }, signal),
      );
    },

    async getTrack(id, options) {
      const track = await playableTrack(id, options?.signal);
      return track ? mapOneValid(track, mapTrack, TrackSchema) : null;
    },

    async getArtist(id, options) {
      const user = await one<AudiusUser>(`/users/${enc(id)}`, options?.signal);
      return user ? mapOneValid(user, mapUser, ArtistSchema) : null;
    },

    async getArtistTracks(id, { limit, sort, signal }) {
      const params = { sort: sort === 'newest' ? 'date' : 'plays', limit };
      return mapTracks(await list<AudiusTrack>(`/users/${enc(id)}/tracks`, params, signal));
    },

    async getRelatedArtists(id, { limit, signal }) {
      const users = await list<AudiusUser>(`/users/${enc(id)}/related`, { limit }, signal);
      return mapValid(users, mapUser, ArtistSchema);
    },

    async getCollection(id, options) {
      const data = await one<AudiusPlaylist[]>(`/playlists/${enc(id)}`, options?.signal);
      const playlist = data?.[0];
      if (!playlist) return null;
      return mapOneValid(playlist, (p) => mapPlaylist(p, { withTracks: true }), CollectionSchema);
    },

    async resolveStream(id, options) {
      const track = await playableTrack(id, options?.signal);
      if (!track) {
        throw new CatalogError('NOT_FOUND', `audius:${id} is not streamable`, {
          upstream: 'audius',
        });
      }
      if (track.stream?.url) {
        return {
          url: track.stream.url,
          mirrors: mirrorUrls(track.stream.url, track.stream.mirrors ?? []),
          live: false,
        };
      }
      const body = await http.getJson<{ data: string | null }>(
        endpoint(`/tracks/${enc(id)}/stream`, { no_redirect: 'true' }),
        { upstream: 'audius', signal: options?.signal },
      );
      if (!body?.data) {
        throw new CatalogError('NOT_FOUND', `audius:${id} has no stream`, { upstream: 'audius' });
      }
      return { url: body.data, mirrors: [], live: false };
    },
  };
}
