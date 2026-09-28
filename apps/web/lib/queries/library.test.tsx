import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { apiError, noContent, stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { queryWrapper } from '@/test/query-wrapper';
import { keys } from './keys';
import { useFollowing, useLikedIds, useLikes, useToggleFollow, useToggleLike } from './library';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const artist = {
  id: 'audius:a1' as const,
  source: 'audius' as const,
  name: 'Kaito',
  avatar: {},
  verified: false,
};

describe('likes', () => {
  test('liking shows the heart at once and keeps it when the server agrees', async () => {
    const liked: string[] = [];
    let release: () => void = () => {};
    const { requests } = stubApi({
      'GET /api/me/likes/ids': () => Response.json(liked),
      'PUT /api/me/likes/audius:t1': () =>
        new Promise<Response>((done) => {
          release = () => {
            liked.push('audius:t1');
            done(noContent());
          };
        }),
    });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => ({ ids: useLikedIds(), toggle: useToggleLike() }), {
      wrapper,
    });
    await waitFor(() => expect(requests).toHaveLength(1));
    act(() => result.current.toggle.mutate({ track: track(1), like: true }));
    await waitFor(() => expect(result.current.ids.has('audius:t1')).toBe(true));
    release();
    await waitFor(() => expect(result.current.toggle.isSuccess).toBe(true));
    expect(result.current.ids.has('audius:t1')).toBe(true);
  });

  test('a failed like rolls back and says why', async () => {
    stubApi({
      'GET /api/me/likes/ids': [],
      'PUT /api/me/likes/audius:t1': () => apiError(502, 'UPSTREAM_ERROR', 'Audius is down'),
    });
    const { wrapper, client } = queryWrapper();
    client.setQueryData(keys.likeIds, []);
    const { result } = renderHook(() => ({ ids: useLikedIds(), toggle: useToggleLike() }), {
      wrapper,
    });
    act(() => result.current.toggle.mutate({ track: track(1), like: true }));
    await waitFor(() => expect(result.current.toggle.isError).toBe(true));
    expect(result.current.ids.has('audius:t1')).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      'Couldn’t like “Track 1”. The music source is having trouble right now.',
    );
  });

  test('pages through liked songs with the cursor', async () => {
    const { requests } = stubApi({
      'GET /api/me/likes': ({ query }) =>
        Response.json(
          query.get('cursor')
            ? { items: [{ track: track(2), likedAt: '2026-01-01T00:00:00Z' }], nextCursor: null }
            : { items: [{ track: track(1), likedAt: '2026-01-02T00:00:00Z' }], nextCursor: 'c1' },
        ),
    });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useLikes(), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    expect(requests[0]?.query.has('cursor')).toBe(false);
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(requests[1]?.query.get('cursor')).toBe('c1');
    expect(result.current.data?.pages.flatMap((page) => page.items)).toHaveLength(2);
  });
});

describe('following', () => {
  test('unfollowing removes the artist at once and restores it on failure', async () => {
    let fail: () => void = () => {};
    stubApi({
      'GET /api/me/following': [artist],
      'DELETE /api/me/following/audius:a1': () =>
        new Promise<Response>((done) => {
          fail = () => done(apiError(500, 'INTERNAL', 'Something went wrong'));
        }),
    });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(
      () => ({ following: useFollowing(), toggle: useToggleFollow() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.following.data).toHaveLength(1));
    act(() => result.current.toggle.mutate({ artist, follow: false }));
    await waitFor(() => expect(result.current.following.data).toHaveLength(0));
    fail();
    await waitFor(() => expect(result.current.toggle.isError).toBe(true));
    await waitFor(() => expect(result.current.following.data).toHaveLength(1));
    expect(toast.error).toHaveBeenCalledWith('Couldn’t unfollow Kaito. Something went wrong');
  });
});
