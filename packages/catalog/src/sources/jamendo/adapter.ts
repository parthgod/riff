import type { SourceAdapter } from '../../adapter';
import { CatalogError } from '../../errors';
import type { HttpClient } from '../../http';
import { mapAlbum, mapArtist, mapTrack, mapTracks, toJamendoTag } from './map';
import type { JamendoAlbum, JamendoArtist, JamendoResponse, JamendoTrack } from './types';

export interface JamendoConfig {
  clientId: string;
  apiUrl?: string;
}

type Params = Record<string, string | number | undefined>;

const DEFAULT_API_URL = 'https://api.jamendo.com/v3.0';
const TRACK_PARAMS: Params = { include: 'musicinfo', audioformat: 'mp32', imagesize: '600' };
const ORDER_BY_WINDOW = {
  week: 'popularity_week',
  month: 'popularity_month',
  allTime: 'popularity_total',
} as const;

export function createJamendoAdapter({
  http,
  config,
}: {
  http: HttpClient;
  config: JamendoConfig;
}): SourceAdapter {
  const base = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');

  async function results<T>(path: string, params: Params, signal?: AbortSignal): Promise<T[]> {
    const url = new URL(`${base}${path}/`);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('format', 'json');
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const body = await http.getJson<JamendoResponse<T>>(url.toString(), {
      upstream: 'jamendo',
      signal,
    });
    if (!body) return [];
    if (body.headers.status !== 'success') {
      throw new CatalogError(
        'UPSTREAM_ERROR',
        `jamendo: ${body.headers.error_message || 'request failed'}`,
        { upstream: 'jamendo' },
      );
    }
    return body.results;
  }

  async function streamableTrack(id: string, signal?: AbortSignal) {
    const tracks = await results<JamendoTrack>('/tracks', { ...TRACK_PARAMS, id }, signal);
    return tracks.find((track) => track.audio) ?? null;
  }

  return {
    id: 'jamendo',

    async searchTracks(query, { limit, signal }) {
      return mapTracks(
        await results<JamendoTrack>('/tracks', { ...TRACK_PARAMS, search: query, limit }, signal),
      );
    },

    async searchArtists(query, { limit, signal }) {
      return (await results<JamendoArtist>('/artists', { namesearch: query, limit }, signal)).map(
        mapArtist,
      );
    },

    async searchCollections(query, { limit, signal }) {
      const albums = await results<JamendoAlbum>(
        '/albums',
        { namesearch: query, limit, imagesize: '600' },
        signal,
      );
      return albums.map((album) => mapAlbum(album, { withTracks: false }));
    },

    async trending({ genre, window = 'week', limit, signal }) {
      const params: Params = {
        ...TRACK_PARAMS,
        order: ORDER_BY_WINDOW[window],
        tags: genre ? toJamendoTag(genre) : undefined,
        limit,
      };
      return mapTracks(await results<JamendoTrack>('/tracks', params, signal));
    },

    async getTrack(id, options) {
      const track = await streamableTrack(id, options?.signal);
      return track ? mapTrack(track) : null;
    },

    async getArtist(id, options) {
      const [artist] = await results<JamendoArtist>('/artists', { id }, options?.signal);
      return artist ? mapArtist(artist) : null;
    },

    async getArtistTracks(id, { limit, signal }) {
      const params: Params = { ...TRACK_PARAMS, artist_id: id, order: 'popularity_total', limit };
      return mapTracks(await results<JamendoTrack>('/tracks', params, signal));
    },

    async getCollection(nativeId, options) {
      if (!nativeId.startsWith('album:')) return null;
      const albumId = nativeId.slice('album:'.length);
      const [album] = await results<JamendoAlbum>(
        '/albums/tracks',
        { id: albumId, audioformat: 'mp32', imagesize: '600' },
        options?.signal,
      );
      return album ? mapAlbum(album, { withTracks: true }) : null;
    },

    async resolveStream(id, options) {
      const track = await streamableTrack(id, options?.signal);
      if (!track) {
        throw new CatalogError('NOT_FOUND', `jamendo:${id} is not streamable`, {
          upstream: 'jamendo',
        });
      }
      return { url: track.audio, mirrors: [], live: false };
    },
  };
}
