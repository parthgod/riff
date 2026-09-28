import type { Lyrics, TrendingWindow } from '@riff/core';
import { useQuery } from '@tanstack/react-query';
import { ApiRequestError, api, unwrap } from '@/lib/api';
import { keys } from './keys';

/** Normalises what the user typed; blank queries are never sent (the API rejects them). */
export const searchText = (q: string): string => q.trim().replace(/\s+/g, ' ');

export function useSearch(q: string) {
  const text = searchText(q);
  return useQuery({
    queryKey: keys.search(text),
    queryFn: () => unwrap(api.search.$get({ query: { q: text, limit: '20' } })),
    enabled: text.length > 0,
    placeholderData: (previous) => previous,
  });
}

export function useTrending(genre: string | null, window: TrendingWindow, limit = 50) {
  return useQuery({
    queryKey: keys.trending(genre, window),
    queryFn: () =>
      unwrap(
        api.trending.$get({ query: { genre: genre ?? undefined, window, limit: String(limit) } }),
      ),
  });
}

export function useArtist(id: string) {
  return useQuery({
    queryKey: keys.artist(id),
    queryFn: () => unwrap(api.artists[':id'].$get({ param: { id } })),
  });
}

export function useArtistTracks(id: string) {
  return useQuery({
    queryKey: keys.artistTracks(id),
    queryFn: () =>
      unwrap(api.artists[':id'].tracks.$get({ param: { id }, query: { limit: '20' } })),
  });
}

export function useRelatedArtists(id: string) {
  return useQuery({
    queryKey: keys.relatedArtists(id),
    queryFn: () =>
      unwrap(api.artists[':id'].related.$get({ param: { id }, query: { limit: '12' } })),
  });
}

export function useCollection(id: string) {
  return useQuery({
    queryKey: keys.collection(id),
    queryFn: () => unwrap(api.collections[':id'].$get({ param: { id } })),
  });
}

/** null when LRCLIB has no lyrics for the track (a 404 is an answer, not an error). */
export function useLyrics(trackId: string | null) {
  return useQuery({
    queryKey: keys.lyrics(trackId ?? ''),
    queryFn: async (): Promise<Lyrics | null> => {
      try {
        return await unwrap(api.tracks[':id'].lyrics.$get({ param: { id: trackId as string } }));
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: trackId !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRadioTop() {
  return useQuery({
    queryKey: keys.radioTop,
    queryFn: () => unwrap(api.radio.top.$get({ query: { limit: '40' } })),
  });
}

export function useRadioSearch(q: string) {
  const text = searchText(q);
  return useQuery({
    queryKey: keys.radioSearch(text),
    queryFn: () => unwrap(api.radio.search.$get({ query: { q: text, limit: '40' } })),
    enabled: text.length > 0,
    placeholderData: (previous) => previous,
  });
}
