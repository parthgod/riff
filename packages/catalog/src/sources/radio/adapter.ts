import type { Track } from '@riff/core';
import type { ListOptions, RadioAdapter } from '../../adapter';
import { CatalogError, isCatalogError } from '../../errors';
import type { HttpClient } from '../../http';
import { isPlayableStreamUrl, isUsableStation, mapStation } from './map';
import type { RadioStation, RadioUrlResponse } from './types';

export interface RadioConfig {
  /** Radio Browser mirror names, tried in order, e.g. ["de1", "de2"]. */
  servers: readonly string[];
}

type Params = Record<string, string | number | undefined>;

/** Many stations fail the https/non-HLS filter, so ask for more than we need. */
const OVERFETCH = 3;

export function createRadioAdapter({
  http,
  config,
}: {
  http: HttpClient;
  config: RadioConfig;
}): RadioAdapter {
  async function get<T>(path: string, params: Params, signal?: AbortSignal): Promise<T | null> {
    let lastError: unknown = new CatalogError('UPSTREAM_ERROR', 'radio: no servers configured', {
      upstream: 'radio',
    });
    for (const server of config.servers) {
      const url = new URL(`https://${server}.api.radio-browser.info/json${path}`);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
      try {
        return await http.getJson<T>(url.toString(), { upstream: 'radio', signal });
      } catch (error) {
        // The time budget is spent; trying another mirror would only overrun it.
        if (isCatalogError(error, 'UPSTREAM_TIMEOUT')) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  async function stations(params: Params, { limit, signal }: ListOptions): Promise<Track[]> {
    const raw = await get<RadioStation[]>(
      '/stations/search',
      {
        hidebroken: 'true',
        order: 'clickcount',
        reverse: 'true',
        ...params,
        limit: limit * OVERFETCH,
      },
      signal,
    );
    return (raw ?? []).filter(isUsableStation).slice(0, limit).map(mapStation);
  }

  return {
    id: 'radio',

    searchTracks: (query, options) => stations({ name: query }, options),

    top: ({ tag, ...options }) => stations({ tag }, options),

    async getTrack(uuid, options) {
      const [station] =
        (await get<RadioStation[]>(
          `/stations/byuuid/${encodeURIComponent(uuid)}`,
          {},
          options?.signal,
        )) ?? [];
      return station && isUsableStation(station) ? mapStation(station) : null;
    },

    async resolveStream(uuid, options) {
      const body = await get<RadioUrlResponse>(
        `/url/${encodeURIComponent(uuid)}`,
        {},
        options?.signal,
      );
      if (!body?.ok || !isPlayableStreamUrl(body.url)) {
        throw new CatalogError('NOT_FOUND', `radio:${uuid} has no playable https stream`, {
          upstream: 'radio',
        });
      }
      return { url: body.url, mirrors: [], live: true };
    },
  };
}
