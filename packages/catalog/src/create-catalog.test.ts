import { describe, expect, test } from 'vitest';
import { catalogConfigFromEnv, createCatalog, DEFAULT_USER_AGENT } from './create-catalog';
import { rawTrack } from './sources/audius/fixtures';
import { rawStation } from './sources/radio/fixtures';
import { fakeFetch } from './testing/fake-fetch';

describe('catalogConfigFromEnv', () => {
  test('uses defaults and leaves Jamendo off without a client id', () => {
    expect(catalogConfigFromEnv({})).toEqual({
      userAgent: DEFAULT_USER_AGENT,
      audius: { apiUrl: 'https://api.audius.co', appName: 'riff' },
      jamendo: null,
      radio: { servers: ['de1', 'de2'] },
    });
  });

  test('reads overrides, enables Jamendo, and disables radio with an empty server list', () => {
    const config = catalogConfigFromEnv({
      AUDIUS_API_URL: 'https://audius.test',
      AUDIUS_APP_NAME: 'mine',
      JAMENDO_CLIENT_ID: 'abc',
      RADIO_BROWSER_SERVERS: ' de2 , ',
    });
    expect(config.audius).toEqual({ apiUrl: 'https://audius.test', appName: 'mine' });
    expect(config.jamendo).toEqual({ clientId: 'abc' });
    expect(config.radio).toEqual({ servers: ['de2'] });
    expect(catalogConfigFromEnv({ RADIO_BROWSER_SERVERS: '' }).radio).toBeNull();
  });
});

describe('createCatalog', () => {
  test('wires Audius and radio and reports Jamendo as disabled without a key', async () => {
    const fetch = fakeFetch([
      { match: 'api.audius.co/v1/tracks/search', json: { data: [rawTrack()] } },
      { match: 'api.audius.co/v1/users/search', json: { data: [] } },
      { match: 'api.audius.co/v1/playlists/search', json: { data: [] } },
      { match: 'api.radio-browser.info/json/stations/search', json: [rawStation()] },
    ]);
    const catalog = createCatalog({ ...catalogConfigFromEnv({}), fetch });
    const result = await catalog.search('lofi', { limit: 5 });
    expect(result.sources).toEqual({ audius: 'ok', jamendo: 'disabled', radio: 'ok' });
    expect(result.tracks).toHaveLength(1);
    expect(result.stations).toHaveLength(1);
    expect(fetch.unmatched).toEqual([]);
    expect(fetch.requests[0]!.headers.get('user-agent')).toBe(DEFAULT_USER_AGENT);
  });
});
