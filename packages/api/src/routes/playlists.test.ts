import { CatalogError } from '@riff/catalog';
import { playlistTracks } from '@riff/db';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeTrack } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.addTracks(...Array.from({ length: 5 }, (_, i) => makeTrack(i + 1)));
});

async function createPlaylist(user: TestUser, name = 'Mix'): Promise<string> {
  const res = await user.post('/me/playlists', { name });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

async function addTracks(user: TestUser, playlistId: string, trackIds: string[]) {
  const res = await user.post(`/me/playlists/${playlistId}/tracks`, { trackIds });
  expect(res.status).toBe(201);
  return (await res.json()).entries as { id: string; track: { id: string } }[];
}

async function trackOrder(user: TestUser, playlistId: string): Promise<string[]> {
  const body = await (await user.get(`/playlists/${playlistId}`)).json();
  return body.entries.map((entry: { track: { id: string } }) => entry.track.id);
}

describe('playlist CRUD', () => {
  test('creates, lists, renames and deletes', async () => {
    const created = await (
      await alice.post('/me/playlists', { name: '  Road trip  ', description: 'Loud' })
    ).json();
    expect(created).toMatchObject({
      name: 'Road trip',
      description: 'Loud',
      coverUrl: null,
      isPublic: false,
      trackCount: 0,
      covers: [],
    });

    const renamed = await alice.patch(`/me/playlists/${created.id}`, {
      name: 'Night drive',
      description: '',
      isPublic: true,
    });
    expect(await renamed.json()).toMatchObject({
      name: 'Night drive',
      description: null,
      isPublic: true,
    });

    const list = await (await alice.get('/me/playlists')).json();
    expect(list.map((p: { name: string }) => p.name)).toEqual(['Night drive']);

    expect((await alice.delete(`/me/playlists/${created.id}`)).status).toBe(204);
    expect(await (await alice.get('/me/playlists')).json()).toEqual([]);
    expect((await alice.get(`/playlists/${created.id}`)).status).toBe(404);
  });

  test('lists the most recently changed playlist first', async () => {
    const older = await createPlaylist(alice, 'Older');
    await createPlaylist(alice, 'Newer');
    await addTracks(alice, older, ['audius:t1']);
    const list = await (await alice.get('/me/playlists')).json();
    expect(list.map((p: { name: string }) => p.name)).toEqual(['Older', 'Newer']);
  });

  test.each([
    ['a blank name', { name: '   ' }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }],
    ['no name', {}],
  ])('rejects %s', async (_, body) => {
    const res = await alice.post('/me/playlists', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  test('an empty PATCH is 400', async () => {
    const id = await createPlaylist(alice);
    const res = await alice.patch(`/me/playlists/${id}`, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Nothing to change');
  });

  test('malformed JSON is 400, not 500', async () => {
    const res = await api.app.request('/api/me/playlists', {
      method: 'POST',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      body: '{"name": ',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  test('a non-UUID playlist id is 400, not a database error', async () => {
    const res = await alice.get('/playlists/not-a-uuid');
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/^id: /);
  });
});

describe('entries', () => {
  test('appends in request order, allows duplicates, and reports count and covers', async () => {
    const id = await createPlaylist(alice);
    await addTracks(alice, id, ['audius:t1', 'audius:t2']);
    const added = await addTracks(alice, id, ['audius:t3', 'audius:t1', 'audius:t4', 'audius:t5']);
    expect(added.map((e) => e.track.id)).toEqual([
      'audius:t3',
      'audius:t1',
      'audius:t4',
      'audius:t5',
    ]);
    expect(new Set(added.map((e) => e.id)).size).toBe(4);

    expect(await trackOrder(alice, id)).toEqual([
      'audius:t1',
      'audius:t2',
      'audius:t3',
      'audius:t1',
      'audius:t4',
      'audius:t5',
    ]);
    const [summary] = await (await alice.get('/me/playlists')).json();
    expect(summary.trackCount).toBe(6);
    expect(summary.covers).toEqual([
      'https://img.example/t1/480.jpg',
      'https://img.example/t2/480.jpg',
      'https://img.example/t3/480.jpg',
      'https://img.example/t1/480.jpg',
    ]);
  });

  test('keeps order across 70 single appends (fractional keys sort byte-wise)', async () => {
    const many = Array.from({ length: 70 }, (_, i) => makeTrack(`m${i}`));
    api.catalog.addTracks(...many);
    const id = await createPlaylist(alice);
    for (const track of many) await addTracks(alice, id, [track.id]);
    expect(await trackOrder(alice, id)).toEqual(many.map((track) => track.id));
  });

  test('covers skip tracks without artwork', async () => {
    api.catalog.addTracks(makeTrack('bare', { artwork: {} }));
    const id = await createPlaylist(alice);
    await addTracks(alice, id, ['audius:tbare', 'audius:t2']);
    const [summary] = await (await alice.get('/me/playlists')).json();
    expect(summary.covers).toEqual(['https://img.example/t2/480.jpg']);
  });

  test('an unknown track rejects the whole request and adds nothing', async () => {
    const id = await createPlaylist(alice);
    const res = await alice.post(`/me/playlists/${id}/tracks`, {
      trackIds: ['audius:t1', 'audius:nope'],
    });
    expect(res.status).toBe(404);
    expect(await api.db.$count(playlistTracks)).toBe(0);
  });

  test('an upstream failure while snapshotting is 502', async () => {
    const id = await createPlaylist(alice);
    api.catalog.getTrack.mockRejectedValueOnce(new CatalogError('UPSTREAM_ERROR', 'down'));
    const res = await alice.post(`/me/playlists/${id}/tracks`, { trackIds: ['audius:t1'] });
    expect(res.status).toBe(502);
  });

  test.each([
    ['an empty list', { trackIds: [] }],
    ['more than 100 ids', { trackIds: Array.from({ length: 101 }, () => 'audius:t1') }],
    ['a malformed id', { trackIds: ['nope'] }],
  ])('rejects %s', async (_, body) => {
    const id = await createPlaylist(alice);
    expect((await alice.post(`/me/playlists/${id}/tracks`, body)).status).toBe(400);
  });

  test('removes one entry, leaving the duplicate', async () => {
    const id = await createPlaylist(alice);
    const [first] = await addTracks(alice, id, ['audius:t1', 'audius:t2', 'audius:t1']);
    expect((await alice.delete(`/me/playlists/${id}/tracks/${first!.id}`)).status).toBe(204);
    expect(await trackOrder(alice, id)).toEqual(['audius:t2', 'audius:t1']);
    expect((await alice.delete(`/me/playlists/${id}/tracks/${first!.id}`)).status).toBe(404);
  });
});

describe('reorder', () => {
  let id: string;
  let entries: { id: string }[];

  beforeEach(async () => {
    id = await createPlaylist(alice);
    entries = await addTracks(alice, id, ['audius:t1', 'audius:t2', 'audius:t3', 'audius:t4']);
  });

  const move = (entryIndex: number, afterIndex: number | null) =>
    alice.patch(`/me/playlists/${id}/tracks/${entries[entryIndex]!.id}`, {
      afterEntryId: afterIndex === null ? null : entries[afterIndex]!.id,
    });

  test('moves an entry to the top', async () => {
    expect((await move(2, null)).status).toBe(204);
    expect(await trackOrder(alice, id)).toEqual([
      'audius:t3',
      'audius:t1',
      'audius:t2',
      'audius:t4',
    ]);
  });

  test('moves an entry down, into the middle and to the end', async () => {
    await move(0, 2);
    expect(await trackOrder(alice, id)).toEqual([
      'audius:t2',
      'audius:t3',
      'audius:t1',
      'audius:t4',
    ]);
    await move(1, 3);
    expect(await trackOrder(alice, id)).toEqual([
      'audius:t3',
      'audius:t1',
      'audius:t4',
      'audius:t2',
    ]);
  });

  test('moving an entry after itself or to where it already is changes nothing', async () => {
    await move(1, 1);
    await move(1, 0);
    expect(await trackOrder(alice, id)).toEqual([
      'audius:t1',
      'audius:t2',
      'audius:t3',
      'audius:t4',
    ]);
  });

  test('stays consistent over many moves between the same neighbours', async () => {
    for (let i = 0; i < 30; i++) await move(i % 2 === 0 ? 3 : 2, 0);
    expect(await trackOrder(alice, id)).toEqual([
      'audius:t1',
      'audius:t3',
      'audius:t4',
      'audius:t2',
    ]);
  });

  test('an unknown afterEntryId is 404', async () => {
    const res = await alice.patch(`/me/playlists/${id}/tracks/${entries[0]!.id}`, {
      afterEntryId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe('No such playlist entry');
  });

  test('afterEntryId must be a UUID or null', async () => {
    const res = await alice.patch(`/me/playlists/${id}/tracks/${entries[0]!.id}`, {});
    expect(res.status).toBe(400);
  });
});

describe('ownership and visibility', () => {
  let bob: TestUser;
  let id: string;

  beforeEach(async () => {
    id = await createPlaylist(alice);
    await addTracks(alice, id, ['audius:t1']);
    bob = await api.signUp('bob');
  });

  test("another user's private playlist is 404 to read and to change", async () => {
    expect((await bob.get(`/playlists/${id}`)).status).toBe(404);
    expect((await bob.patch(`/me/playlists/${id}`, { name: 'Mine now' })).status).toBe(404);
    expect((await bob.delete(`/me/playlists/${id}`)).status).toBe(404);
    expect((await bob.post(`/me/playlists/${id}/tracks`, { trackIds: ['audius:t2'] })).status).toBe(
      404,
    );
    expect(api.catalog.getTrack).not.toHaveBeenCalledWith('audius:t2');
    expect(await trackOrder(alice, id)).toEqual(['audius:t1']);
  });

  test('a public playlist is readable by others, but only its owner may edit it', async () => {
    await alice.patch(`/me/playlists/${id}`, { isPublic: true });
    const res = await bob.get(`/playlists/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      isOwner: false,
      entries: [{ track: { id: 'audius:t1' } }],
    });
    expect((await bob.patch(`/me/playlists/${id}`, { name: 'x' })).status).toBe(404);
    expect((await (await alice.get(`/playlists/${id}`)).json()).isOwner).toBe(true);
  });

  test("the list shows only the user's own playlists", async () => {
    await alice.patch(`/me/playlists/${id}`, { isPublic: true });
    expect(await (await bob.get('/me/playlists')).json()).toEqual([]);
  });

  test('playlist reads come from the DB while the catalog is down', async () => {
    api.catalog.getTrack.mockRejectedValue(new CatalogError('UPSTREAM_ERROR', 'down'));
    expect(await trackOrder(alice, id)).toEqual(['audius:t1']);
  });
});
