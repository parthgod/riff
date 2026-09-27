import type { Artist, Collection, SourceId, StreamInfo, Track, TrendingWindow } from '@riff/core';

export interface CallOptions {
  signal?: AbortSignal;
}

export interface ListOptions extends CallOptions {
  limit: number;
}

export interface TrendingOptions extends ListOptions {
  genre?: string;
  window?: TrendingWindow;
}

/** One music source. Optional methods are capabilities a source may lack. */
export interface SourceAdapter {
  readonly id: SourceId;
  searchTracks(query: string, options: ListOptions): Promise<Track[]>;
  searchArtists?(query: string, options: ListOptions): Promise<Artist[]>;
  searchCollections?(query: string, options: ListOptions): Promise<Collection[]>;
  trending?(options: TrendingOptions): Promise<Track[]>;
  /** Resolves to null when the id is unknown or not playable. */
  getTrack(nativeId: string, options?: CallOptions): Promise<Track | null>;
  getArtist?(nativeId: string, options?: CallOptions): Promise<Artist | null>;
  getArtistTracks?(nativeId: string, options: ListOptions): Promise<Track[]>;
  getRelatedArtists?(nativeId: string, options: ListOptions): Promise<Artist[]>;
  /** Includes playable tracks. */
  getCollection?(nativeId: string, options?: CallOptions): Promise<Collection | null>;
  /** Rejects with CatalogError NOT_FOUND when the item cannot be streamed. */
  resolveStream(nativeId: string, options?: CallOptions): Promise<StreamInfo>;
}

export interface RadioAdapter extends SourceAdapter {
  top(options: ListOptions & { tag?: string }): Promise<Track[]>;
}
