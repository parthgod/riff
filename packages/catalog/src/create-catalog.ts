import type { SourceId } from '@riff/core';
import type { SourceAdapter } from './adapter';
import { type Catalog, createAggregator } from './aggregator';
import { type Cache, createMemoryCache } from './cache';
import { createHttpClient, type FetchLike } from './http';
import { createLrclibClient } from './lyrics/lrclib';
import { type AudiusConfig, createAudiusAdapter } from './sources/audius/adapter';
import { createJamendoAdapter, type JamendoConfig } from './sources/jamendo/adapter';
import { createRadioAdapter, type RadioConfig } from './sources/radio/adapter';

export const DEFAULT_USER_AGENT = 'Riff/0.1 (personal music player)';

export interface CatalogConfig {
  userAgent: string;
  audius: AudiusConfig;
  /** null disables Jamendo (no client id). */
  jamendo: JamendoConfig | null;
  /** null disables radio. */
  radio: RadioConfig | null;
  lrclibUrl?: string;
  fetch?: FetchLike;
  searchTimeoutMs?: number;
  entityTimeoutMs?: number;
  onSourceError?: (source: SourceId, error: unknown) => void;
}

export function catalogConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): CatalogConfig {
  const servers = (env.RADIO_BROWSER_SERVERS ?? 'de1,de2')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  return {
    userAgent: DEFAULT_USER_AGENT,
    audius: {
      apiUrl: env.AUDIUS_API_URL || 'https://api.audius.co',
      appName: env.AUDIUS_APP_NAME || 'riff',
    },
    jamendo: env.JAMENDO_CLIENT_ID ? { clientId: env.JAMENDO_CLIENT_ID } : null,
    radio: servers.length > 0 ? { servers } : null,
  };
}

export function createCatalog(config: CatalogConfig, cache: Cache = createMemoryCache()): Catalog {
  const http = createHttpClient({ fetch: config.fetch, userAgent: config.userAgent });
  const music: SourceAdapter[] = [createAudiusAdapter({ http, config: config.audius })];
  if (config.jamendo) music.push(createJamendoAdapter({ http, config: config.jamendo }));
  return createAggregator({
    music,
    radio: config.radio ? createRadioAdapter({ http, config: config.radio }) : null,
    lyrics: createLrclibClient({ http, baseUrl: config.lrclibUrl }),
    cache,
    searchTimeoutMs: config.searchTimeoutMs,
    entityTimeoutMs: config.entityTimeoutMs,
    onSourceError: config.onSourceError,
  });
}
