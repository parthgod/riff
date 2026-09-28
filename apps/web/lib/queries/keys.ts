import type { TrendingWindow } from '@riff/core';

/** Query keys. Everything under `me` is the signed-in user's library. */
export const keys = {
  home: ['home'] as const,
  search: (q: string) => ['search', q] as const,
  trending: (genre: string | null, window: TrendingWindow) => ['trending', genre, window] as const,
  lyrics: (trackId: string) => ['lyrics', trackId] as const,
  artist: (id: string) => ['artist', id] as const,
  artistTracks: (id: string) => ['artist', id, 'tracks'] as const,
  relatedArtists: (id: string) => ['artist', id, 'related'] as const,
  collection: (id: string) => ['collection', id] as const,
  radioTop: ['radio', 'top'] as const,
  radioSearch: (q: string) => ['radio', 'search', q] as const,
  playlist: (id: string) => ['playlist', id] as const,
  me: ['me'] as const,
  likes: ['me', 'likes', 'pages'] as const,
  likeIds: ['me', 'likes', 'ids'] as const,
  playlists: ['me', 'playlists'] as const,
  following: ['me', 'following'] as const,
  recent: ['me', 'recent'] as const,
};
