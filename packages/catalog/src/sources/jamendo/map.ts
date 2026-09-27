import { type Artist, type Artwork, type Collection, makeEntityId, type Track } from '@riff/core';
import type { JamendoAlbum, JamendoAlbumTrack, JamendoArtist, JamendoTrack } from './types';

const TAG_BY_GENRE: Readonly<Record<string, string>> = {
  'Hip-Hop/Rap': 'hiphop',
  'R&B/Soul': 'rnb',
  'Lo-Fi': 'lofi',
  'Drum & Bass': 'drumnbass',
};

export function toJamendoTag(genre: string): string {
  return TAG_BY_GENRE[genre] ?? genre.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function fromJamendoTag(tag: string): string {
  const known = Object.keys(TAG_BY_GENRE).find((genre) => TAG_BY_GENRE[genre] === tag);
  return known ?? tag.charAt(0).toUpperCase() + tag.slice(1);
}

/** Jamendo image URLs take a `width` parameter; derive our three sizes from it. */
export function jamendoArtwork(image: string | null | undefined): Artwork {
  if (!image) return {};
  const sized = (width: number): string => {
    try {
      const url = new URL(image);
      if (!url.searchParams.has('width')) return image;
      url.searchParams.set('width', String(width));
      return url.toString();
    } catch {
      return image;
    }
  };
  return { sm: sized(200), md: sized(500), lg: sized(600) };
}

function seconds(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const albumEntityId = (id: string) => makeEntityId('jamendo', `album:${id}`);

export function mapTrack(track: JamendoTrack): Track {
  const tag = track.musicinfo?.tags?.genres?.[0];
  const hasAlbum = Boolean(track.album_id && track.album_id !== '0' && track.album_name);
  return {
    id: makeEntityId('jamendo', track.id),
    source: 'jamendo',
    title: track.name.trim() || 'Untitled',
    artists: [{ id: makeEntityId('jamendo', track.artist_id), name: track.artist_name }],
    album: hasAlbum ? { id: albumEntityId(track.album_id), title: track.album_name } : undefined,
    durationSec: seconds(track.duration),
    isLive: false,
    artwork: jamendoArtwork(track.image || track.album_image),
    genre: tag ? fromJamendoTag(tag) : undefined,
    releaseDate: track.releasedate || undefined,
    permalink: track.shareurl || undefined,
  };
}

export const mapTracks = (tracks: readonly JamendoTrack[]): Track[] =>
  tracks.filter((track) => track.audio).map(mapTrack);

export function mapArtist(artist: JamendoArtist): Artist {
  return {
    id: makeEntityId('jamendo', artist.id),
    source: 'jamendo',
    name: artist.name,
    avatar: jamendoArtwork(artist.image),
    verified: false,
  };
}

function mapAlbumTrack(track: JamendoAlbumTrack, album: JamendoAlbum): Track {
  return {
    id: makeEntityId('jamendo', track.id),
    source: 'jamendo',
    title: track.name.trim() || 'Untitled',
    artists: [{ id: makeEntityId('jamendo', album.artist_id), name: album.artist_name }],
    album: { id: albumEntityId(album.id), title: album.name },
    durationSec: seconds(track.duration),
    isLive: false,
    artwork: jamendoArtwork(album.image),
    releaseDate: album.releasedate || undefined,
  };
}

export function mapAlbum(album: JamendoAlbum, { withTracks }: { withTracks: boolean }): Collection {
  const streamable = (album.tracks ?? []).filter((track) => track.audio);
  return {
    id: albumEntityId(album.id),
    source: 'jamendo',
    kind: 'album',
    title: album.name,
    artwork: jamendoArtwork(album.image),
    owner: { id: makeEntityId('jamendo', album.artist_id), name: album.artist_name },
    trackCount: album.tracks ? streamable.length : undefined,
    tracks: withTracks ? streamable.map((track) => mapAlbumTrack(track, album)) : undefined,
  };
}
