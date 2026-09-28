import { afterEach, expect, test, vi } from 'vitest';
import { recordPlay, resolveStream } from './remote';

afterEach(() => vi.unstubAllGlobals());

test('resolveStream asks the API for the stream as JSON', async () => {
  const info = { url: 'https://a.test/1', mirrors: ['https://b.test/1'], live: false };
  const fetch = vi.fn(async () => Response.json(info));
  vi.stubGlobal('fetch', fetch);
  await expect(resolveStream('audius:t1')).resolves.toEqual(info);
  expect(fetch).toHaveBeenCalledWith('/api/stream/audius:t1?format=json', expect.anything());
});

test('resolveStream rejects when the API fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ error: { code: 'UPSTREAM_ERROR', message: 'down' } }, { status: 502 }),
    ),
  );
  await expect(resolveStream('audius:t1')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
});

test('recordPlay posts the play', async () => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }),
  );
  vi.stubGlobal('fetch', fetch);
  await recordPlay({ trackId: 'audius:t1', msPlayed: 30_000, context: 'liked' });
  const [url, init] = fetch.mock.calls[0] ?? [];
  expect(url).toBe('/api/me/history');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toEqual({
    trackId: 'audius:t1',
    msPlayed: 30_000,
    context: 'liked',
  });
});
