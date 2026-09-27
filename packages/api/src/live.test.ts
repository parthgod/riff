import { catalogConfigFromEnv, createCatalog } from '@riff/catalog';
import { TrackSchema } from '@riff/core';
import { createTestDb, truncateAll } from '@riff/db/testing';
import { afterAll, describe, expect, test } from 'vitest';
import { createApp } from './app';
import { createAuth } from './auth';

// The whole API against the real upstreams and riff_test.
// Run with: set -a && . ./.env && set +a && pnpm --filter @riff/api test:live
describe.skipIf(!process.env.LIVE)('live API', { timeout: 60_000 }, () => {
  const { db, close } = createTestDb();
  const auth = createAuth({
    db,
    secret: 'riff-live-test-secret-4f0c9a2e7b1d3856',
    baseURL: 'http://localhost:3000',
    allowSignups: true,
  });
  const app = createApp({ db, catalog: createCatalog(catalogConfigFromEnv(process.env)), auth });
  afterAll(() => close());

  test('sign up, search, stream, like, record a play, see it on home', async () => {
    await truncateAll(db);
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Live',
        email: 'live@example.com',
        password: 'live-test-pw-123',
      }),
    });
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const get = (path: string) => app.request(`/api${path}`, { headers: { cookie } });
    const send = (method: string, path: string, body?: unknown) =>
      app.request(`/api${path}`, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    const search = await (await get('/search?q=lofi&limit=5')).json();
    expect(search.sources.audius).toBe('ok');
    const track = TrackSchema.parse(search.tracks[0]);

    const stream = await (await get(`/stream/${track.id}?format=json`)).json();
    expect(stream.url).toMatch(/^https:\/\//);

    expect((await send('PUT', `/me/likes/${track.id}`)).status).toBe(204);
    const likes = await (await get('/me/likes')).json();
    expect(likes.items[0].track.id).toBe(track.id);

    expect(
      (await send('POST', '/me/history', { trackId: track.id, msPlayed: 30_000 })).status,
    ).toBe(204);
    const home = await (await get('/home')).json();
    expect(home.recentlyPlayed[0].id).toBe(track.id);
    expect(home.trending.length).toBeGreaterThan(0);

    await truncateAll(db);
  });
});
