import { CatalogError } from '@riff/catalog';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeArtist } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.addArtists(makeArtist(1), makeArtist(2));
});

const following = async (user: TestUser) =>
  ((await (await user.get('/me/following')).json()) as { id: string }[]).map((a) => a.id);

describe('following', () => {
  test('follows artists (newest first) with their snapshot', async () => {
    expect((await alice.put('/me/following/audius:a1')).status).toBe(204);
    await alice.put('/me/following/audius:a2');
    const res = await alice.get('/me/following');
    const body = await res.json();
    expect(body.map((a: { id: string }) => a.id)).toEqual(['audius:a2', 'audius:a1']);
    expect(body[1]).toEqual(makeArtist(1));
  });

  test('following twice is idempotent and refreshes the snapshot', async () => {
    await alice.put('/me/following/audius:a1');
    api.catalog.addArtists(makeArtist(1, { name: 'Renamed' }));
    await alice.put('/me/following/audius:a1');
    const body = await (await alice.get('/me/following')).json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Renamed');
  });

  test('unfollow is idempotent and needs no upstream', async () => {
    await alice.put('/me/following/audius:a1');
    api.catalog.getArtist.mockRejectedValue(new CatalogError('UPSTREAM_ERROR', 'down'));
    expect((await alice.delete('/me/following/audius:a1')).status).toBe(204);
    expect((await alice.delete('/me/following/audius:a1')).status).toBe(204);
    expect(await following(alice)).toEqual([]);
  });

  test('an unknown artist is 404; a malformed id is 400', async () => {
    expect((await alice.put('/me/following/audius:nope')).status).toBe(404);
    expect((await alice.put('/me/following/nope')).status).toBe(400);
    expect(await following(alice)).toEqual([]);
  });

  test('is private to each user', async () => {
    await alice.put('/me/following/audius:a1');
    const bob = await api.signUp('bob');
    expect(await following(bob)).toEqual([]);
  });
});
