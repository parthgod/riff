import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, api, expectOk, setUnauthorizedHandler, unwrap } from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(response: Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe('unwrap', () => {
  test('returns the JSON body of a successful response', async () => {
    const fetch = stubFetch(json(['audius:a']));
    await expect(unwrap(api.me.likes.ids.$get())).resolves.toEqual(['audius:a']);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/me/likes/ids');
  });

  test('sends query values and omits undefined ones', async () => {
    const fetch = stubFetch(json({ tracks: [], sources: {} }));
    await unwrap(api.trending.$get({ query: { genre: undefined, window: 'month', limit: '5' } }));
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/trending?window=month&limit=5');
  });

  test('throws ApiRequestError with the error contract fields', async () => {
    stubFetch(json({ error: { code: 'UPSTREAM_ERROR', message: 'Audius is down' } }, 502));
    const error = await unwrap(api.tracks[':id'].$get({ param: { id: 'audius:x' } })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 502, code: 'UPSTREAM_ERROR', message: 'Audius is down' });
  });

  test('falls back to a generic error when the body is not the contract', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(unwrap(api.home.$get())).rejects.toMatchObject({
      status: 502,
      code: 'INTERNAL',
      message: 'Request failed (502)',
    });
  });

  test('calls the unauthorized handler on 401', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to continue' } }, 401));
    await expect(unwrap(api.home.$get())).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('expectOk', () => {
  test('resolves for 204 responses', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(
      expectOk(api.me.likes[':trackId'].$put({ param: { trackId: 'audius:a' } })),
    ).resolves.toBeUndefined();
  });

  test('throws for errors', async () => {
    stubFetch(json({ error: { code: 'NOT_FOUND', message: 'No such track' } }, 404));
    await expect(
      expectOk(api.me.likes[':trackId'].$put({ param: { trackId: 'audius:a' } })),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
