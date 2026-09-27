import { playHistory } from '@riff/db';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeTrack } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.addTracks(makeTrack(1), makeTrack(2), makeTrack(3));
});

const recent = async (user: TestUser, query = '') =>
  ((await (await user.get(`/me/history/recent${query}`)).json()) as { id: string }[]).map(
    (t) => t.id,
  );

describe('POST /me/history', () => {
  test('records a play with its context and snapshots the track', async () => {
    const res = await alice.post('/me/history', {
      trackId: 'audius:t1',
      msPlayed: 30_000,
      context: 'playlist:abc',
    });
    expect(res.status).toBe(204);
    const [row] = await api.db.select().from(playHistory);
    expect(row).toMatchObject({
      userId: alice.id,
      trackId: 'audius:t1',
      msPlayed: 30_000,
      context: 'playlist:abc',
    });
  });

  test.each([
    ['negative msPlayed', { trackId: 'audius:t1', msPlayed: -1 }],
    ['fractional msPlayed', { trackId: 'audius:t1', msPlayed: 1.5 }],
    ['msPlayed over a day', { trackId: 'audius:t1', msPlayed: 86_400_001 }],
    ['a malformed track id', { trackId: 't1', msPlayed: 1 }],
    [
      'a context over 200 characters',
      { trackId: 'audius:t1', msPlayed: 1, context: 'x'.repeat(201) },
    ],
  ])('rejects %s', async (_, body) => {
    expect((await alice.post('/me/history', body)).status).toBe(400);
    expect(await api.db.$count(playHistory)).toBe(0);
  });

  test('an unknown track is 404 and nothing is recorded', async () => {
    const res = await alice.post('/me/history', { trackId: 'audius:nope', msPlayed: 1 });
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe('Nothing found for audius:nope');
    expect(await api.db.$count(playHistory)).toBe(0);
  });
});

describe('GET /me/history/recent', () => {
  test('lists distinct tracks by their latest play, newest first', async () => {
    for (const id of ['audius:t1', 'audius:t2', 'audius:t1', 'audius:t3', 'audius:t2']) {
      await alice.post('/me/history', { trackId: id, msPlayed: 30_000 });
      // Plays within one millisecond would tie; spread them out.
      await api.db.execute(
        sql`update play_history set played_at = played_at - interval '1 minute'`,
      );
    }
    expect(await recent(alice)).toEqual(['audius:t2', 'audius:t3', 'audius:t1']);
    expect(await recent(alice, '?limit=2')).toEqual(['audius:t2', 'audius:t3']);
  });

  test('limit is bounded', async () => {
    expect((await alice.get('/me/history/recent?limit=51')).status).toBe(400);
  });

  test('is private to each user', async () => {
    await alice.post('/me/history', { trackId: 'audius:t1', msPlayed: 30_000 });
    const bob = await api.signUp('bob');
    expect(await recent(bob)).toEqual([]);
  });
});
