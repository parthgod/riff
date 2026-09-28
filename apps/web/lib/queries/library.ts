import type { Artist, EntityId, Track } from '@riff/core';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, expectOk, unwrap } from '@/lib/api';
import { describeError } from '@/lib/query-client';
import { keys } from './keys';

export function useHome() {
  return useQuery({ queryKey: keys.home, queryFn: () => unwrap(api.home.$get()) });
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => unwrap(api.me.$get()),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRecentlyPlayed() {
  return useQuery({
    queryKey: keys.recent,
    queryFn: () => unwrap(api.me.history.recent.$get({ query: { limit: '20' } })),
  });
}

/** Liked songs, newest first, 50 per page. */
export function useLikes() {
  return useInfiniteQuery({
    queryKey: keys.likes,
    queryFn: ({ pageParam }) => unwrap(api.me.likes.$get({ query: { cursor: pageParam } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/** Every liked track id, for heart buttons. */
export function useLikedIds(): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: keys.likeIds,
    queryFn: () => unwrap(api.me.likes.ids.$get()),
    select: (ids) => new Set<string>(ids),
    staleTime: 5 * 60_000,
  });
  return data ?? EMPTY_IDS;
}

/** Likes or unlikes a track, updating hearts at once and rolling back with a toast on failure. */
export function useToggleLike() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ track, like }: { track: Track; like: boolean }) => {
      const param = { param: { trackId: track.id } };
      return expectOk(
        like ? api.me.likes[':trackId'].$put(param) : api.me.likes[':trackId'].$delete(param),
      );
    },
    onMutate: async ({ track, like }) => {
      await client.cancelQueries({ queryKey: keys.likeIds });
      const previous = client.getQueryData<EntityId[]>(keys.likeIds);
      client.setQueryData<EntityId[]>(keys.likeIds, (ids = []) =>
        like
          ? [track.id, ...ids.filter((id) => id !== track.id)]
          : ids.filter((id) => id !== track.id),
      );
      return { previous };
    },
    onError: (error, { track, like }, context) => {
      client.setQueryData(keys.likeIds, context?.previous);
      toast.error(`Couldn’t ${like ? 'like' : 'unlike'} “${track.title}”. ${describeError(error)}`);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.likeIds });
      void client.invalidateQueries({ queryKey: keys.likes });
    },
  });
}

export function useFollowing() {
  return useQuery({ queryKey: keys.following, queryFn: () => unwrap(api.me.following.$get()) });
}

/** Follows or unfollows an artist optimistically; rolls back with a toast on failure. */
export function useToggleFollow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ artist, follow }: { artist: Artist; follow: boolean }) => {
      const param = { param: { artistId: artist.id } };
      return expectOk(
        follow
          ? api.me.following[':artistId'].$put(param)
          : api.me.following[':artistId'].$delete(param),
      );
    },
    onMutate: async ({ artist, follow }) => {
      await client.cancelQueries({ queryKey: keys.following });
      const previous = client.getQueryData<Artist[]>(keys.following);
      client.setQueryData<Artist[]>(keys.following, (artists = []) => {
        const others = artists.filter((a) => a.id !== artist.id);
        return follow ? [artist, ...others] : others;
      });
      return { previous };
    },
    onError: (error, { artist, follow }, context) => {
      client.setQueryData(keys.following, context?.previous);
      toast.error(
        `Couldn’t ${follow ? 'follow' : 'unfollow'} ${artist.name}. ${describeError(error)}`,
      );
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.following });
      void client.invalidateQueries({ queryKey: keys.home });
    },
  });
}
