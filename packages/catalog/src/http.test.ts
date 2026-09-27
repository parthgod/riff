import { describe, expect, test } from 'vitest';
import { createHttpClient } from './http';
import { fakeFetch } from './testing/fake-fetch';

describe('createHttpClient().getJson', () => {
  test('parses JSON and sends accept and user-agent headers', async () => {
    const fetch = fakeFetch([{ match: '/ok', json: { hello: 'world' } }]);
    const http = createHttpClient({ fetch, userAgent: 'Riff/test' });
    await expect(http.getJson('https://x.test/ok', { upstream: 'x' })).resolves.toEqual({
      hello: 'world',
    });
    expect(fetch.requests[0]!.headers.get('user-agent')).toBe('Riff/test');
    expect(fetch.requests[0]!.headers.get('accept')).toBe('application/json');
  });

  test('resolves null for not-found statuses', async () => {
    const fetch = fakeFetch([
      { match: '/missing', status: 404, json: {} },
      { match: '/bad-id', status: 400, json: {} },
    ]);
    const http = createHttpClient({ fetch, userAgent: 'ua' });
    await expect(http.getJson('https://x.test/missing', { upstream: 'x' })).resolves.toBeNull();
    await expect(
      http.getJson('https://x.test/bad-id', { upstream: 'x', notFoundStatuses: [400, 404] }),
    ).resolves.toBeNull();
  });

  test('maps other HTTP errors to UPSTREAM_ERROR tagged with the upstream', async () => {
    const http = createHttpClient({
      fetch: fakeFetch([{ match: '/', status: 503, json: {} }]),
      userAgent: 'ua',
    });
    await expect(http.getJson('https://x.test/', { upstream: 'audius' })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      upstream: 'audius',
    });
  });

  test('maps timeouts to UPSTREAM_TIMEOUT', async () => {
    const http = createHttpClient({
      fetch: fakeFetch([{ match: '/slow', delayMs: 500, json: {} }]),
      userAgent: 'ua',
    });
    await expect(
      http.getJson('https://x.test/slow', { upstream: 'x', signal: AbortSignal.timeout(20) }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });

  test('maps network failures and invalid JSON to UPSTREAM_ERROR', async () => {
    const fetch = fakeFetch([
      { match: '/down', error: new TypeError('fetch failed') },
      { match: '/html', text: '<html>' },
    ]);
    const http = createHttpClient({ fetch, userAgent: 'ua' });
    await expect(http.getJson('https://x.test/down', { upstream: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    await expect(http.getJson('https://x.test/html', { upstream: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
  });
});
