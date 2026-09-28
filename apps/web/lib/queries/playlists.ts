import type { PlaylistDetail, PlaylistSummary } from '@riff/api';
import type { EntityId } from '@riff/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, expectOk, unwrap } from '@/lib/api';
import { describeError } from '@/lib/query-client';
import { keys } from './keys';

/** The entry a moved entry ends up after, when dragged from index `from` to `to` (null: first). */
export function afterIdForMove(ids: readonly string[], from: number, to: number): string | null {
  const rest = ids.filter((_, index) => index !== from);
  return to <= 0 ? null : (rest[Math.min(to, rest.length) - 1] ?? null);
}

/** `entries` with `entryId` moved right after `afterEntryId` (or to the top for null). */
export function moveAfter<T extends { id: string }>(
  entries: readonly T[],
  entryId: string,
  afterEntryId: string | null,
): T[] {
  const moved = entries.find((entry) => entry.id === entryId);
  if (!moved) return entries.slice();
  const rest = entries.filter((entry) => entry.id !== entryId);
  const at = afterEntryId === null ? 0 : rest.findIndex((entry) => entry.id === afterEntryId) + 1;
  rest.splice(at, 0, moved);
  return rest;
}

export function usePlaylists() {
  return useQuery({ queryKey: keys.playlists, queryFn: () => unwrap(api.me.playlists.$get()) });
}

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: keys.playlist(id),
    queryFn: () => unwrap(api.playlists[':id'].$get({ param: { id } })),
  });
}

export function useCreatePlaylist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      unwrap(api.me.playlists.$post({ json: input })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.playlists }),
    onError: (error) => toast.error(`Couldn’t create the playlist. ${describeError(error)}`),
  });
}

export interface PlaylistPatch {
  name?: string;
  description?: string | null;
  isPublic?: boolean;
}

export function useUpdatePlaylist(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: PlaylistPatch) =>
      unwrap(api.me.playlists[':id'].$patch({ param: { id }, json: patch })),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: keys.playlist(id) });
      const previous = client.getQueryData<PlaylistDetail>(keys.playlist(id));
      client.setQueryData<PlaylistDetail>(keys.playlist(id), (playlist) =>
        playlist ? { ...playlist, ...patch } : playlist,
      );
      return { previous };
    },
    onError: (error, _patch, context) => {
      client.setQueryData(keys.playlist(id), context?.previous);
      toast.error(`Couldn’t save the playlist. ${describeError(error)}`);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.playlist(id) });
      void client.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}

export function useDeletePlaylist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => expectOk(api.me.playlists[':id'].$delete({ param: { id } })),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: keys.playlists });
      const previous = client.getQueryData<PlaylistSummary[]>(keys.playlists);
      client.setQueryData<PlaylistSummary[]>(keys.playlists, (list) =>
        list?.filter((playlist) => playlist.id !== id),
      );
      return { previous };
    },
    onError: (error, _id, context) => {
      client.setQueryData(keys.playlists, context?.previous);
      toast.error(`Couldn’t delete the playlist. ${describeError(error)}`);
    },
    onSuccess: (_result, id) => client.removeQueries({ queryKey: keys.playlist(id) }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.playlists }),
  });
}

export function useAddToPlaylist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ playlist, trackIds }: { playlist: PlaylistSummary; trackIds: EntityId[] }) =>
      unwrap(
        api.me.playlists[':id'].tracks.$post({ param: { id: playlist.id }, json: { trackIds } }),
      ),
    onSuccess: (_result, { playlist, trackIds }) => {
      toast(
        trackIds.length === 1
          ? `Added to ${playlist.name}`
          : `Added ${trackIds.length} tracks to ${playlist.name}`,
      );
    },
    onError: (error, { playlist }) =>
      toast.error(`Couldn’t add to ${playlist.name}. ${describeError(error)}`),
    onSettled: (_result, _error, { playlist }) => {
      void client.invalidateQueries({ queryKey: keys.playlist(playlist.id) });
      void client.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}

export function useMoveEntry(playlistId: string) {
  const client = useQueryClient();
  const key = keys.playlist(playlistId);
  return useMutation({
    mutationFn: ({ entryId, afterEntryId }: { entryId: string; afterEntryId: string | null }) =>
      expectOk(
        api.me.playlists[':id'].tracks[':entryId'].$patch({
          param: { id: playlistId, entryId },
          json: { afterEntryId },
        }),
      ),
    onMutate: async ({ entryId, afterEntryId }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<PlaylistDetail>(key);
      client.setQueryData<PlaylistDetail>(key, (playlist) =>
        playlist
          ? { ...playlist, entries: moveAfter(playlist.entries, entryId, afterEntryId) }
          : playlist,
      );
      return { previous };
    },
    onError: (error, _move, context) => {
      client.setQueryData(key, context?.previous);
      toast.error(`Couldn’t move the track. ${describeError(error)}`);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}

export function useRemoveEntry(playlistId: string) {
  const client = useQueryClient();
  const key = keys.playlist(playlistId);
  return useMutation({
    mutationFn: (entryId: string) =>
      expectOk(
        api.me.playlists[':id'].tracks[':entryId'].$delete({ param: { id: playlistId, entryId } }),
      ),
    onMutate: async (entryId) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<PlaylistDetail>(key);
      client.setQueryData<PlaylistDetail>(key, (playlist) =>
        playlist
          ? {
              ...playlist,
              trackCount: playlist.trackCount - 1,
              entries: playlist.entries.filter((entry) => entry.id !== entryId),
            }
          : playlist,
      );
      return { previous };
    },
    onError: (error, _entryId, context) => {
      client.setQueryData(key, context?.previous);
      toast.error(`Couldn’t remove the track. ${describeError(error)}`);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}
