import type { PlaylistDetail } from '@riff/api';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { apiError, noContent, stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { queryWrapper } from '@/test/query-wrapper';
import { keys } from './keys';
import {
  afterIdForMove,
  moveAfter,
  useAddToPlaylist,
  useMoveEntry,
  usePlaylist,
  useRemoveEntry,
} from './playlists';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const PID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

function detail(entryIds: string[]): PlaylistDetail {
  return {
    id: PID,
    name: 'Night drive',
    description: null,
    coverUrl: null,
    isPublic: false,
    trackCount: entryIds.length,
    covers: [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ownerId: 'u1',
    isOwner: true,
    entries: entryIds.map((id, i) => ({
      id,
      track: track(i + 1),
      addedAt: '2026-09-01T00:00:00Z',
    })),
  };
}

const entryIds = (playlist: PlaylistDetail | undefined) => playlist?.entries.map((e) => e.id);

describe('reorder helpers', () => {
  const ids = ['a', 'b', 'c', 'd'];

  test.each([
    [0, 2, 'c'],
    [3, 0, null],
    [3, 1, 'a'],
    [1, 3, 'd'],
    [2, 2, 'b'],
  ])('moving index %i to %i follows %j', (from, to, expected) => {
    expect(afterIdForMove(ids, from, to)).toBe(expected);
  });

  test('moveAfter agrees with afterIdForMove', () => {
    const entries = ids.map((id) => ({ id }));
    for (let from = 0; from < ids.length; from++) {
      for (let to = 0; to < ids.length; to++) {
        const expected = ids.slice();
        const [moved] = expected.splice(from, 1);
        expected.splice(to, 0, moved as string);
        const after = afterIdForMove(ids, from, to);
        expect(moveAfter(entries, ids[from] as string, after).map((e) => e.id)).toEqual(expected);
      }
    }
  });
});

describe('playlist edits', () => {
  test('a reorder shows at once and sends the new neighbour', async () => {
    let order = ['e1', 'e2', 'e3'];
    let release: () => void = () => {};
    const { requests } = stubApi({
      [`GET /api/playlists/${PID}`]: () => Response.json(detail(order)),
      [`PATCH /api/me/playlists/${PID}/tracks/e3`]: () =>
        new Promise<Response>((done) => {
          release = () => {
            order = ['e3', 'e1', 'e2'];
            done(noContent());
          };
        }),
    });
    const { wrapper, client } = queryWrapper();
    const { result } = renderHook(() => ({ playlist: usePlaylist(PID), move: useMoveEntry(PID) }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.playlist.isSuccess).toBe(true));
    act(() => result.current.move.mutate({ entryId: 'e3', afterEntryId: null }));
    await waitFor(() =>
      expect(entryIds(client.getQueryData(keys.playlist(PID)))).toEqual(['e3', 'e1', 'e2']),
    );
    release();
    await waitFor(() => expect(result.current.move.isSuccess).toBe(true));
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({ afterEntryId: null });
  });

  test('a failed reorder snaps back and says so', async () => {
    stubApi({
      [`GET /api/playlists/${PID}`]: () => Response.json(detail(['e1', 'e2'])),
      [`PATCH /api/me/playlists/${PID}/tracks/e2`]: () => apiError(404, 'NOT_FOUND', 'Gone'),
    });
    const { wrapper, client } = queryWrapper();
    const { result } = renderHook(() => ({ playlist: usePlaylist(PID), move: useMoveEntry(PID) }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.playlist.isSuccess).toBe(true));
    act(() => result.current.move.mutate({ entryId: 'e2', afterEntryId: null }));
    await waitFor(() => expect(result.current.move.isError).toBe(true));
    expect(entryIds(client.getQueryData(keys.playlist(PID)))).toEqual(['e1', 'e2']);
    expect(toast.error).toHaveBeenCalledWith(
      'Couldn’t move the track. This page doesn’t exist, or was removed.',
    );
  });

  test('removing an entry drops only that entry (duplicates stay)', async () => {
    stubApi({
      [`GET /api/playlists/${PID}`]: () => Response.json(detail(['e1', 'e2'])),
      [`DELETE /api/me/playlists/${PID}/tracks/e1`]: () => new Promise<Response>(() => {}),
    });
    const { wrapper, client } = queryWrapper();
    const { result } = renderHook(
      () => ({ playlist: usePlaylist(PID), remove: useRemoveEntry(PID) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.playlist.isSuccess).toBe(true));
    act(() => result.current.remove.mutate('e1'));
    await waitFor(() => expect(entryIds(client.getQueryData(keys.playlist(PID)))).toEqual(['e2']));
    expect(client.getQueryData<PlaylistDetail>(keys.playlist(PID))?.trackCount).toBe(1);
  });

  test('adding tracks confirms with a toast naming the playlist', async () => {
    const { requests } = stubApi({
      [`POST /api/me/playlists/${PID}/tracks`]: () =>
        Response.json({ entries: [] }, { status: 201 }),
      'GET /api/me/playlists': [],
    });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useAddToPlaylist(), { wrapper });
    act(() => result.current.mutate({ playlist: detail([]), trackIds: [track(1).id] }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests[0]?.body).toEqual({ trackIds: ['audius:t1'] });
    expect(toast).toHaveBeenCalledWith('Added to Night drive');
  });
});
