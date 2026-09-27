import { beforeEach, expect, test } from 'vitest';
import { createApiClient } from './client';
import { makeTrack } from './testing/fixtures';
import { setupApi, type TestUser } from './testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.addTracks(makeTrack(1));
});

const client = (cookie?: string) =>
  createApiClient('http://localhost/api', {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => api.app.request(input, init),
    headers: cookie ? { cookie } : {},
  });

test('the typed client reaches public and session routes', async () => {
  const health = await client().health.$get();
  expect(await health.json()).toEqual({ ok: true });

  const signedIn = client(alice.cookie);
  const put = await signedIn.me.likes[':trackId'].$put({ param: { trackId: 'audius:t1' } });
  expect(put.status).toBe(204);

  const likes = await signedIn.me.likes.$get({ query: {} });
  const page = await likes.json();
  // Typed access: a compile error here means AppType lost its inference.
  expect(page.items[0]?.track.title).toBe('Track 1');

  const search = await signedIn.search.$get({ query: { q: 'lofi', limit: '5' } });
  expect((await search.json()).sources.audius).toBe('ok');
});
