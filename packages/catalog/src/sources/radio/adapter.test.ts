import { describe, expect, test } from 'vitest';
import { createHttpClient } from '../../http';
import { type FakeRoute, fakeFetch } from '../../testing/fake-fetch';
import { createRadioAdapter } from './adapter';
import { rawStation } from './fixtures';

function setup(routes: FakeRoute[], servers = ['de1', 'de2']) {
  const fetch = fakeFetch(routes);
  const adapter = createRadioAdapter({
    http: createHttpClient({ fetch, userAgent: 'ua' }),
    config: { servers },
  });
  return { adapter, fetch, url: (i = 0) => new URL(fetch.requests[i]!.url) };
}

describe('radio adapter', () => {
  test('searchTracks over-fetches, filters unusable stations and trims to the limit', async () => {
    const stations = [
      rawStation({ stationuuid: 'a' }),
      rawStation({ stationuuid: 'b', url_resolved: 'http://insecure.test/' }),
      rawStation({ stationuuid: 'c' }),
      rawStation({ stationuuid: 'd' }),
    ];
    const { adapter, url } = setup([{ match: '/json/stations/search', json: stations }]);
    const result = await adapter.searchTracks('lofi', { limit: 2 });
    expect(result.map((t) => t.id)).toEqual(['radio:a', 'radio:c']);
    expect(url().host).toBe('de1.api.radio-browser.info');
    expect(Object.fromEntries(url().searchParams)).toMatchObject({
      name: 'lofi',
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      limit: '6',
    });
  });

  test('top filters by tag when given one', async () => {
    const { adapter, url } = setup([{ match: '/json/stations/search', json: [rawStation()] }]);
    await adapter.top({ tag: 'jazz', limit: 5 });
    expect(url(0).searchParams.get('tag')).toBe('jazz');
    await adapter.top({ limit: 5 });
    expect(url(1).searchParams.has('tag')).toBe(false);
    expect(url(1).searchParams.has('name')).toBe(false);
  });

  test('fails over to the next server on upstream errors', async () => {
    const { adapter, fetch } = setup([
      { match: 'de1.api', status: 500, json: {} },
      { match: 'de2.api', json: [rawStation()] },
    ]);
    expect(await adapter.searchTracks('x', { limit: 1 })).toHaveLength(1);
    expect(fetch.requests.map((r) => new URL(r.url).host)).toEqual([
      'de1.api.radio-browser.info',
      'de2.api.radio-browser.info',
    ]);
  });

  test('does not fail over after a timeout', async () => {
    const { adapter, fetch } = setup([{ match: 'de1.api', delayMs: 300, json: [] }]);
    await expect(
      adapter.searchTracks('x', { limit: 1, signal: AbortSignal.timeout(20) }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    expect(fetch.requests).toHaveLength(1);
  });

  test('getTrack returns usable stations only', async () => {
    const { adapter } = setup([
      { match: '/byuuid/ok', json: [rawStation({ stationuuid: 'ok' })] },
      { match: '/byuuid/hls', json: [rawStation({ stationuuid: 'hls', hls: 1 })] },
      { match: '/byuuid/none', json: [] },
    ]);
    expect((await adapter.getTrack('ok'))?.id).toBe('radio:ok');
    expect(await adapter.getTrack('hls')).toBeNull();
    expect(await adapter.getTrack('none')).toBeNull();
  });

  test('resolveStream uses the click-counting url endpoint and rejects insecure streams', async () => {
    const { adapter } = setup([
      { match: '/json/url/good', json: { ok: true, url: 'https://s.test/live.mp3' } },
      { match: '/json/url/http', json: { ok: true, url: 'http://s.test/live.mp3' } },
      { match: '/json/url/bad', json: { ok: false, message: 'no station' } },
    ]);
    await expect(adapter.resolveStream('good')).resolves.toEqual({
      url: 'https://s.test/live.mp3',
      mirrors: [],
      live: true,
    });
    await expect(adapter.resolveStream('http')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adapter.resolveStream('bad')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
