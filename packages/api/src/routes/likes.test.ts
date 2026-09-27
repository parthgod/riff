import { CatalogError } from '@riff/catalog';
import { likedTracks, tracks } from '@riff/db';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeTrack } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.addTracks(makeTrack(1), makeTrack(2), makeTrack(3));
});

const likedIds = async (user: TestUser) => (await user.get('/me/likes/ids')).json();

describe('PUT /me/likes/:trackId', () => {
  test('likes a track and stores its snapshot', async () => {
    const res = await alice.put('/me/likes/audius:t1');
    expect(res.status).toBe(204);
    expect(await likedIds(alice)).toEqual(['audius:t1']);

    const [row] = await api.db.select().from(tracks).where(eq(tracks.id, 'audius:t1'));
    expect(row).toMatchObject({
      source: 'audius',
      title: 'Track 1',
      artistName: 'Artist 1',
      data: makeTrack(1),
    });
  });

  test('is idempotent and keeps the original like time', async () => {
    await alice.put('/me/likes/audius:t1');
    const [first] = await api.db.select().from(likedTracks);
    await alice.put('/me/likes/audius:t1');
    const rows = await api.db.select().from(likedTracks);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdAt).toEqual(first!.createdAt);
  });

  test('refreshes an existing snapshot with the latest catalog data', async () => {
    await alice.put('/me/likes/audius:t1');
    api.catalog.addTracks(makeTrack(1, { title: 'Track 1 (Remastered)' }));
    await alice.put('/me/likes/audius:t1');
    const [row] = await api.db.select().from(tracks).where(eq(tracks.id, 'audius:t1'));
    expect(row!.title).toBe('Track 1 (Remastered)');
  });

  test('stores radio stations, which have no artists', async () => {
    api.catalog.addTracks(
      makeTrack('r', {
        id: 'radio:abc',
        source: 'radio',
        artists: [],
        durationSec: null,
        isLive: true,
      }),
    );
    expect((await alice.put('/me/likes/radio:abc')).status).toBe(204);
    const [row] = await api.db.select().from(tracks).where(eq(tracks.id, 'radio:abc'));
    expect(row!.artistName).toBe('');
  });

  test('an unknown track is 404 and nothing is stored', async () => {
    const res = await alice.put('/me/likes/audius:nope');
    expect(res.status).toBe(404);
    expect(await likedIds(alice)).toEqual([]);
  });

  test('an upstream failure is 502 and nothing is stored', async () => {
    api.catalog.getTrack.mockRejectedValueOnce(new CatalogError('UPSTREAM_ERROR', 'down'));
    expect((await alice.put('/me/likes/audius:t1')).status).toBe(502);
    expect(await api.db.$count(tracks)).toBe(0);
  });

  test('a malformed id is 400', async () => {
    const res = await alice.put('/me/likes/not-an-id');
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/^trackId: /);
  });
});

describe('DELETE /me/likes/:trackId', () => {
  test('unlikes, and unliking again is still 204', async () => {
    await alice.put('/me/likes/audius:t1');
    expect((await alice.delete('/me/likes/audius:t1')).status).toBe(204);
    expect((await alice.delete('/me/likes/audius:t1')).status).toBe(204);
    expect(await likedIds(alice)).toEqual([]);
  });

  test('works while the catalog is down (no upstream call)', async () => {
    await alice.put('/me/likes/audius:t1');
    api.catalog.getTrack.mockRejectedValue(new CatalogError('UPSTREAM_ERROR', 'down'));
    expect((await alice.delete('/me/likes/audius:t1')).status).toBe(204);
  });
});

describe('GET /me/likes', () => {
  test('lists newest first with the like time, from the DB even when the catalog is down', async () => {
    await alice.put('/me/likes/audius:t1');
    await alice.put('/me/likes/audius:t2');
    api.catalog.getTrack.mockRejectedValue(new CatalogError('UPSTREAM_ERROR', 'down'));

    const res = await alice.get('/me/likes');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((item: { track: { id: string } }) => item.track.id)).toEqual([
      'audius:t2',
      'audius:t1',
    ]);
    expect(body.items[0].track).toEqual(makeTrack(2));
    expect(Date.parse(body.items[0].likedAt)).not.toBeNaN();
    expect(body.nextCursor).toBeNull();
  });

  test('pages through 120 likes, 50 at a time, without gaps or repeats even on equal timestamps', async () => {
    const all = Array.from({ length: 120 }, (_, i) => makeTrack(`p${i}`));
    api.catalog.addTracks(...all);
    for (const track of all) await alice.put(`/me/likes/${track.id}`);
    // 31 likes (tp1, tp10-tp19, tp100-tp119) share one timestamp, as after a bulk import; the
    // oldest-first tail puts the page 2/3 boundary inside that group.
    await api.db.execute(
      sql`update liked_tracks set created_at = '2026-01-01T00:00:00Z' where track_id like 'audius:tp1%'`,
    );

    const seen: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | null = null;
    do {
      const path: string = cursor ? `/me/likes?cursor=${encodeURIComponent(cursor)}` : '/me/likes';
      const body: { items: { track: { id: string } }[]; nextCursor: string | null } = await (
        await alice.get(path)
      ).json();
      pageSizes.push(body.items.length);
      seen.push(...body.items.map((item) => item.track.id));
      cursor = body.nextCursor;
    } while (cursor);

    expect(pageSizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual(await likedIds(alice));
  });

  test('a malformed cursor is 400', async () => {
    expect((await alice.get('/me/likes?cursor=garbage')).status).toBe(400);
  });

  test('likes are private to each user', async () => {
    await alice.put('/me/likes/audius:t1');
    const bob = await api.signUp('bob');
    expect(await likedIds(bob)).toEqual([]);
    expect((await (await bob.get('/me/likes')).json()).items).toEqual([]);
  });
});
